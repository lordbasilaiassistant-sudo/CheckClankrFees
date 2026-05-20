// Clanker discovery. Discovery is a UNION of multiple signals — anywhere
// the connected wallet could plausibly have a claim:
//
//   1. tokenAdmin at creation        (TokenCreated.tokenAdmin indexed)
//   2. msgSender at creation         (= deployer, often == admin but not always)
//   3. (future) fee recipient sets, splitter beneficiaries, etc.
//
// All signals run in parallel via the RPC aggregator's quorum getLogs.
// Results are deduped by token address.

import { getAddress } from 'viem';
import { log } from '../../debug.js';
import { rpc, getBlockNumber, getLogs } from '../../rpc/index.js';
import { readCache, writeCache } from '../../scanCache.js';
import { DEFAULT_SCAN_CHUNK, DEFAULT_SCAN_CONCURRENCY, DEFAULT_SCAN_LOOKBACK_BLOCKS } from '../../../constants.js';
import { sanitizeText, safeAddress, HASH_RE_64 } from '../../clanker/sanitize.js';
import { TOKEN_CREATED_EVENT } from './events.js';
import { CLANKER_V4, CLANKER_LINK } from './constants.js';

const PLUGIN_ID = 'clanker';
const MIN_CHUNK = 500n;

function envBig(name, def) {
  const raw = import.meta.env?.[name];
  if (!raw) return def;
  try { const n = BigInt(String(raw)); return n > 0n ? n : def; }
  catch { return def; }
}

/** Walk TokenCreated events in chunks via quorum getLogs, filtered by an
 *  indexed argument (tokenAdmin or tokenAddress). Returns raw viem logs. */
async function scanIndexed({ from, to, indexedArg, factory }) {
  return scanRange(factory, indexedArg, from, to, 1);
}

async function scanRange(factory, args, from, to, label) {
  const endChunk = log.time('clanker', `chunk #${label}`, { from: from.toString(), to: to.toString() });
  try {
    const logs = await getLogs({
      address: factory,
      event: TOKEN_CREATED_EVENT,
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
      scanRange(factory, args, from, mid, `${label}a`),
      scanRange(factory, args, mid + 1n, to, `${label}b`),
    ]);
    return [...a, ...b];
  }
}

function parseLogToLaunch(ev) {
  const a = ev.args || {};
  const token = safeAddress(a.tokenAddress);
  const admin = safeAddress(a.tokenAdmin);
  const txHash = HASH_RE_64.test(ev.transactionHash || '') ? ev.transactionHash : null;
  if (!token || !admin || !txHash) {
    log.warn('clanker', 'discarding malformed TokenCreated', { tokenAddress: a.tokenAddress, txHash: ev.transactionHash });
    return null;
  }
  return {
    pluginId: PLUGIN_ID,
    token,
    name: sanitizeText(a.tokenName),
    symbol: sanitizeText(a.tokenSymbol, 16),
    image: typeof a.tokenImage === 'string' ? a.tokenImage : '',
    deployedAt: { blockNumber: ev.blockNumber, txHash },
    links: [
      { label: 'clanker', url: CLANKER_LINK(token), kind: 'protocol' },
      { label: 'scan',    url: `https://basescan.org/address/${token}`, kind: 'explorer' },
      { label: 'tx',      url: `https://basescan.org/tx/${txHash}`,     kind: 'tx' },
    ],
    meta: {
      admin,
      deployer: safeAddress(a.msgSender),
      locker:   safeAddress(a.locker),
      poolHook: safeAddress(a.poolHook),
      pairedToken: safeAddress(a.pairedToken),
    },
  };
}

/** Main entry — implements the plugin `scanLaunches(address, opts)` contract. */
export async function scanLaunches(address, { signal, onProgress, onCached, useCache = true, chainId = 8453, concurrency } = {}) {
  const cfg = CLANKER_V4[chainId];
  if (!cfg) return [];
  const userAddr = getAddress(address);

  // Cache scoped per (plugin × chain × address). Lets us swap plugins
  // independently without invalidating each other's caches.
  const cacheKey = `${PLUGIN_ID}:${chainId}:${userAddr.toLowerCase()}`;
  const cached = useCache ? readCache(cacheKey) : null;
  const cachedLaunches = cached?.tokens ?? [];
  if (cached) onCached?.(cachedLaunches);

  const factoryFloor = envBig('VITE_SCAN_FROM_BLOCK', cfg.factoryDeployBlock);
  const lookbackBlocks = envBig('VITE_SCAN_LOOKBACK_BLOCKS', DEFAULT_SCAN_LOOKBACK_BLOCKS);
  const chunkSize = envBig('VITE_SCAN_CHUNK', DEFAULT_SCAN_CHUNK);

  const endDone = log.time('clanker', 'scanLaunches', { address: userAddr, cached: cachedLaunches.length });
  const head = await getBlockNumber();

  // Pick the start block: resume past cache if present, else apply the
  // lookback window (default ~30 days). Lookback can be disabled by
  // setting VITE_SCAN_LOOKBACK_BLOCKS=0, in which case we walk from the
  // factory deploy block.
  const lookbackFloor = lookbackBlocks > 0n && head > lookbackBlocks
    ? head - lookbackBlocks
    : factoryFloor;
  const effectiveFloor = lookbackFloor > factoryFloor ? lookbackFloor : factoryFloor;
  const fromStart = cached?.scannedToBlock != null && cached.scannedToBlock >= effectiveFloor
    ? cached.scannedToBlock + 1n
    : effectiveFloor;
  if (fromStart > head) {
    endDone({ launches: cachedLaunches.length, cacheHit: true });
    return cachedLaunches;
  }

  // Build chunk list and run multiple discovery signals in parallel.
  // Signal 1: tokenAdmin == user (covers "tokens I'm currently admin of at creation")
  // Signal 2: tokenAddress matches a token where msgSender == user is a future
  //          enrichment — there's no separate indexed field for msgSender, so
  //          we'd have to walk unfiltered events. Skipped for v1.
  const ranges = [];
  for (let cursor = fromStart; cursor <= head; cursor = cursor + chunkSize + 1n) {
    const toBlock = (cursor + chunkSize) > head ? head : (cursor + chunkSize);
    ranges.push({ from: cursor, to: toBlock });
  }
  // Reverse: scan head→floor so the user sees newest deploys first. Tokens
  // most likely to have unclaimed fees are recent ones; populating those in
  // the first few seconds gives immediate value while older history fills in.
  ranges.reverse();
  const totalRanges = ranges.length;
  const limit = Math.min(
    concurrency ?? Number(import.meta.env?.VITE_SCAN_CONCURRENCY ?? DEFAULT_SCAN_CONCURRENCY),
    Math.max(1, rpc.healthyCount()),
  );
  log.info('clanker', `running ${totalRanges} chunks at concurrency=${limit}`);

  const seen = new Set();
  const launches = [];
  for (const l of cachedLaunches) if (l.token) seen.add(l.token.toLowerCase());
  let nextIdx = 0, completedRanges = 0;

  const worker = async () => {
    while (!signal?.aborted) {
      const i = nextIdx++;
      if (i >= ranges.length) return;
      const { from, to } = ranges[i];
      const logs = await scanIndexed({
        from, to,
        indexedArg: { tokenAdmin: userAddr },
        factory: cfg.factory,
      });
      for (const ev of logs) {
        const tokenAddr = ev.args?.tokenAddress;
        if (!tokenAddr || seen.has(tokenAddr.toLowerCase())) continue;
        seen.add(tokenAddr.toLowerCase());
        const parsed = parseLogToLaunch(ev);
        if (parsed) launches.push(parsed);
      }
      completedRanges++;
      onProgress?.({
        scanned: Number((BigInt(completedRanges) * (chunkSize + 1n))),
        total: Number(head - fromStart),
        fromBlock: from, toBlock: to,
        found: cachedLaunches.length + launches.length,
        completedRanges, totalRanges,
      });
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));

  if (signal?.aborted) {
    endDone({ launches: cachedLaunches.length + launches.length, aborted: true });
    return [...cachedLaunches, ...launches];
  }

  const merged = [...cachedLaunches, ...launches];
  writeCache(cacheKey, { tokens: merged, scannedToBlock: head });
  endDone({ launches: merged.length, newThisRun: launches.length });
  return merged;
}
