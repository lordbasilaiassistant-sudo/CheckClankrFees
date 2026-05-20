// Doppler discovery — primary signal is Collect events (the user has been
// paid by this token, so there's likely more to claim). Secondary signals
// (deployer, fee admin) can be added later by extending this file.
//
// The Collect event has `to` indexed, so server-side filtering on the
// connected wallet is a single topic match — cheap to chunk-scan.
//
// We then pull the token's name/symbol via Multicall3 erc20 reads, since
// the event doesn't carry metadata.

import { getAddress, parseAbi } from 'viem';
import { log } from '../../debug.js';
import { rpc, getBlockNumber, getLogs } from '../../rpc/index.js';
import { readCache, writeCache } from '../../scanCache.js';
import { DEFAULT_SCAN_CHUNK, DEFAULT_SCAN_CONCURRENCY, DEFAULT_SCAN_LOOKBACK_BLOCKS } from '../../../constants.js';
import { sanitizeText, safeAddress, HASH_RE_64 } from '../../clanker/sanitize.js';
import { COLLECT_EVENT } from './events.js';
import { DOPPLER, DOPPLER_TOKEN_LINK } from './constants.js';

const PLUGIN_ID = 'doppler';
const MIN_CHUNK = 500n;
const ERC20_META_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

function envBig(name, def) {
  const raw = import.meta.env?.[name];
  if (!raw) return def;
  try { const n = BigInt(String(raw)); return n > 0n ? n : def; }
  catch { return def; }
}

async function scanRange(airlock, args, from, to, label) {
  const endChunk = log.time('doppler', `chunk #${label}`, { from: from.toString(), to: to.toString() });
  try {
    const logs = await getLogs({
      address: airlock,
      event: COLLECT_EVENT,
      args,
      fromBlock: from, toBlock: to,
    });
    endChunk({ matches: logs.length });
    return logs;
  } catch (e) {
    endChunk({ error: e?.message }, 'warn');
    const span = to - from;
    if (span <= MIN_CHUNK) return [];
    const mid = from + (span / 2n);
    const [a, b] = await Promise.all([
      scanRange(airlock, args, from, mid, `${label}a`),
      scanRange(airlock, args, mid + 1n, to, `${label}b`),
    ]);
    return [...a, ...b];
  }
}

/** Pull name/symbol for many tokens in one multicall. */
async function fetchMetadata(tokens) {
  const calls = [];
  for (const t of tokens) {
    calls.push({ address: t, abi: ERC20_META_ABI, functionName: 'name' });
    calls.push({ address: t, abi: ERC20_META_ABI, functionName: 'symbol' });
  }
  let results;
  try {
    results = await rpc.withClient('doppler.metadata', (c) =>
      c.multicall({ contracts: calls, allowFailure: true, batchSize: 50 })
    );
  } catch {
    return new Map(); // metadata is best-effort
  }
  const out = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const nameR = results[i * 2], symR = results[i * 2 + 1];
    out.set(tokens[i], {
      name: nameR?.status === 'success' ? sanitizeText(nameR.result) : '',
      symbol: symR?.status === 'success' ? sanitizeText(symR.result, 16) : '',
    });
  }
  return out;
}

export async function scanLaunches(address, { signal, onProgress, onCached, useCache = true, chainId = 8453, concurrency } = {}) {
  const cfg = DOPPLER[chainId];
  if (!cfg) return [];
  const userAddr = getAddress(address);
  const cacheKey = `${PLUGIN_ID}:${chainId}:${userAddr.toLowerCase()}`;
  const cached = useCache ? readCache(cacheKey) : null;
  const cachedLaunches = cached?.tokens ?? [];
  if (cached) onCached?.(cachedLaunches);

  const floor = envBig('VITE_SCAN_FROM_BLOCK', cfg.airlockDeployBlock);
  const lookbackBlocks = envBig('VITE_SCAN_LOOKBACK_BLOCKS', DEFAULT_SCAN_LOOKBACK_BLOCKS);
  const chunkSize = envBig('VITE_SCAN_CHUNK', DEFAULT_SCAN_CHUNK);

  const endDone = log.time('doppler', 'scanLaunches', { address: userAddr, cached: cachedLaunches.length });
  const head = await getBlockNumber();

  const lookbackFloor = lookbackBlocks > 0n && head > lookbackBlocks
    ? head - lookbackBlocks
    : floor;
  const effectiveFloor = lookbackFloor > floor ? lookbackFloor : floor;
  const fromStart = cached?.scannedToBlock != null && cached.scannedToBlock >= effectiveFloor
    ? cached.scannedToBlock + 1n
    : effectiveFloor;
  if (fromStart > head) {
    endDone({ launches: cachedLaunches.length, cacheHit: true });
    return cachedLaunches;
  }

  const ranges = [];
  for (let cursor = fromStart; cursor <= head; cursor = cursor + chunkSize + 1n) {
    const toBlock = (cursor + chunkSize) > head ? head : (cursor + chunkSize);
    ranges.push({ from: cursor, to: toBlock });
  }
  // Newest blocks first — see clanker/discovery.js for rationale.
  ranges.reverse();
  const totalRanges = ranges.length;
  const limit = Math.min(
    concurrency ?? Number(import.meta.env?.VITE_SCAN_CONCURRENCY ?? DEFAULT_SCAN_CONCURRENCY),
    Math.max(1, rpc.healthyCount()),
  );

  // For Doppler we collect: token → { firstSeenBlock, firstSeenTx, lifetimeCollected }
  const seenTokens = new Map();
  for (const l of cachedLaunches) {
    if (l.token) seenTokens.set(l.token.toLowerCase(), {
      blockNumber: BigInt(l.deployedAt?.blockNumber || 0),
      txHash: l.deployedAt?.txHash || null,
      lifetimeCollected: BigInt(l.meta?.lifetimeCollected || 0),
    });
  }
  let nextIdx = 0, completedRanges = 0;

  const worker = async () => {
    while (!signal?.aborted) {
      const i = nextIdx++;
      if (i >= ranges.length) return;
      const { from, to } = ranges[i];
      const logs = await scanRange(cfg.airlock, { to: userAddr }, from, to, i + 1);
      for (const ev of logs) {
        const tok = safeAddress(ev.args?.token);
        if (!tok) continue;
        const key = tok.toLowerCase();
        const txHash = HASH_RE_64.test(ev.transactionHash || '') ? ev.transactionHash : null;
        const amount = BigInt(ev.args?.amount || 0);
        const prev = seenTokens.get(key);
        if (!prev) {
          seenTokens.set(key, { blockNumber: ev.blockNumber, txHash, lifetimeCollected: amount });
        } else {
          prev.lifetimeCollected += amount;
          // earlier-block wins as "firstSeen"
          if (ev.blockNumber < prev.blockNumber) {
            prev.blockNumber = ev.blockNumber; prev.txHash = txHash;
          }
        }
      }
      completedRanges++;
      onProgress?.({
        scanned: Number((BigInt(completedRanges) * (chunkSize + 1n))),
        total: Number(head - fromStart),
        fromBlock: from, toBlock: to,
        found: seenTokens.size,
        completedRanges, totalRanges,
      });
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));

  // Materialize all tokens, fetch metadata for ones we don't already have.
  const allTokens = [...seenTokens.keys()].map((k) => getAddress(k));
  const tokensNeedingMeta = allTokens.filter((t) => {
    const cachedRow = cachedLaunches.find((l) => l.token === t);
    return !cachedRow || !cachedRow.name;
  });
  const metaMap = tokensNeedingMeta.length ? await fetchMetadata(tokensNeedingMeta) : new Map();

  const merged = allTokens.map((t) => {
    const info = seenTokens.get(t.toLowerCase());
    const cachedRow = cachedLaunches.find((l) => l.token === t);
    const meta = metaMap.get(t) || {};
    return {
      pluginId: PLUGIN_ID,
      token: t,
      name: cachedRow?.name || meta.name || '',
      symbol: cachedRow?.symbol || meta.symbol || '',
      image: cachedRow?.image || '',
      deployedAt: { blockNumber: info.blockNumber, txHash: info.txHash },
      links: [
        { label: 'doppler', url: DOPPLER_TOKEN_LINK(t),                         kind: 'protocol' },
        { label: 'scan',    url: `https://basescan.org/address/${t}`,           kind: 'explorer' },
        ...(info.txHash ? [{ label: 'tx', url: `https://basescan.org/tx/${info.txHash}`, kind: 'tx' }] : []),
      ],
      meta: {
        lifetimeCollected: info.lifetimeCollected.toString(), // serialized for cache
      },
    };
  });

  if (signal?.aborted) {
    endDone({ launches: merged.length, aborted: true });
    return merged;
  }
  writeCache(cacheKey, { tokens: merged, scannedToBlock: head });
  endDone({ launches: merged.length, newSinceCache: merged.length - cachedLaunches.length });
  return merged;
}
