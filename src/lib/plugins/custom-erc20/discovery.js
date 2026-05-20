// custom-erc20 discovery — find tokens the user deployed via OpenZeppelin
// Wizard, Remix, or a one-off custom contract (i.e. NOT through any of
// the known launchers: Clanker, Doppler, etc.).
//
// Approach (Option B from the spec): scan Transfer(from=0x0, to=user)
// events across the whole chain in chunks. Because `from` and `to` are
// both indexed in the standard ERC-20 Transfer event, the RPC server-side
// filters on (zeroAddress, userAddr) → very cheap topic match, suits our
// quorum-getLogs aggregator the same way Doppler's `Collect(to)` does.
//
// Why Option B over Option A (outbound tx walker):
//   - tx walking requires per-block iteration to enumerate tx.from, then
//     per-tx receipt fetches to read `contractAddress`. No indexed
//     filter exists — every block is hit. That's 31M+ blocks on Base.
//   - Transfer-from-zero leans on existing indexed topics, so the RPC
//     does all the heavy lifting. We piggyback on rpc.withQuorum and the
//     existing chunked-scan worker pattern that Clanker/Doppler already
//     use — zero new RPC primitives.
//   - Worst case for Option B is overcounting tokens the user merely
//     received first (e.g. seed allocations from another deployer). The
//     ≥50%-of-totalSupply heuristic in constants.js filters those out.
//
// After log discovery we run two Multicall3 rounds:
//   1) totalSupply() per candidate token — reject anything that doesn't
//      respond (= not an ERC-20) AND apply the ≥50% heuristic.
//   2) name() / symbol() per surviving token — purely cosmetic for the UI.

import { getAddress, parseAbi } from 'viem';
import { log } from '../../debug.js';
import { rpc, getBlockNumber, getLogs } from '../../rpc/index.js';
import { readCache, writeCache } from '../../scanCache.js';
import { DEFAULT_SCAN_CHUNK, DEFAULT_SCAN_CONCURRENCY } from '../../../constants.js';
import { sanitizeText, safeAddress, HASH_RE_64 } from '../../clanker/sanitize.js';
import { TRANSFER_EVENT, ZERO_ADDRESS } from './events.js';
import { CUSTOM_ERC20, CUSTOM_TOKEN_LINK, DEPLOY_MINT_THRESHOLD_BPS } from './constants.js';

const PLUGIN_ID = 'custom-erc20';
const MIN_CHUNK = 500n;

const ERC20_META_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
]);

function envBig(name, def) {
  const raw = import.meta.env?.[name];
  if (!raw) return def;
  try { const n = BigInt(String(raw)); return n > 0n ? n : def; }
  catch { return def; }
}

/** Chunked log fetch with adaptive bisection on RPC failure — same shape
 *  as clanker/doppler scanRange, but no `address` filter (we want matches
 *  across every contract on chain). */
async function scanRange(args, from, to, label) {
  const endChunk = log.time('custom-erc20', `chunk #${label}`, { from: from.toString(), to: to.toString() });
  try {
    const logs = await getLogs({
      // No `address` — we want every contract's Transfer that matches the
      // (from=0x0, to=user) topic pair. The RPC handles the filtering.
      event: TRANSFER_EVENT,
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
      scanRange(args, from, mid, `${label}a`),
      scanRange(args, mid + 1n, to, `${label}b`),
    ]);
    return [...a, ...b];
  }
}

/** Per-token: read totalSupply + name + symbol via one Multicall3 batch.
 *  Returns Map<tokenAddr, { totalSupply, name, symbol, ok }>. */
async function fetchMetadata(tokens) {
  if (!tokens.length) return new Map();
  const calls = [];
  for (const t of tokens) {
    calls.push({ address: t, abi: ERC20_META_ABI, functionName: 'totalSupply' });
    calls.push({ address: t, abi: ERC20_META_ABI, functionName: 'name' });
    calls.push({ address: t, abi: ERC20_META_ABI, functionName: 'symbol' });
  }
  let results;
  try {
    results = await rpc.withClient('custom-erc20.metadata', (c) =>
      c.multicall({ contracts: calls, allowFailure: true, batchSize: 50 })
    );
  } catch (e) {
    log.warn('custom-erc20', 'metadata multicall failed entirely', { msg: e?.message });
    return new Map();
  }
  const out = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const tsR = results[i * 3];
    const nameR = results[i * 3 + 1];
    const symR = results[i * 3 + 2];
    // totalSupply must succeed for us to call this an ERC-20 at all.
    const ok = tsR?.status === 'success';
    out.set(tokens[i], {
      totalSupply: ok ? BigInt(tsR.result || 0) : 0n,
      name:   nameR?.status === 'success' ? sanitizeText(nameR.result) : '',
      symbol: symR?.status  === 'success' ? sanitizeText(symR.result, 16) : '',
      ok,
    });
  }
  return out;
}

/** Main entry — implements the plugin `scanLaunches(address, opts)` contract. */
export async function scanLaunches(address, { signal, onProgress, onCached, useCache = true, chainId = 8453, concurrency } = {}) {
  const cfg = CUSTOM_ERC20[chainId];
  if (!cfg) return [];
  const userAddr = getAddress(address);
  const cacheKey = `${PLUGIN_ID}:${chainId}:${userAddr.toLowerCase()}`;
  const cached = useCache ? readCache(cacheKey) : null;
  const cachedLaunches = cached?.tokens ?? [];
  if (cached) onCached?.(cachedLaunches);

  const floor = envBig('VITE_SCAN_FROM_BLOCK', cfg.scanFloorBlock);
  const fromStart = cached?.scannedToBlock != null && cached.scannedToBlock >= floor
    ? cached.scannedToBlock + 1n
    : floor;
  const chunkSize = envBig('VITE_SCAN_CHUNK', DEFAULT_SCAN_CHUNK);

  const endDone = log.time('custom-erc20', 'scanLaunches', { address: userAddr, fromStart: fromStart.toString(), cached: cachedLaunches.length });
  const head = await getBlockNumber();
  if (fromStart > head) {
    endDone({ launches: cachedLaunches.length, cacheHit: true });
    return cachedLaunches;
  }

  const ranges = [];
  for (let cursor = fromStart; cursor <= head; cursor = cursor + chunkSize + 1n) {
    const toBlock = (cursor + chunkSize) > head ? head : (cursor + chunkSize);
    ranges.push({ from: cursor, to: toBlock });
  }
  const totalRanges = ranges.length;
  const limit = Math.min(
    concurrency ?? Number(import.meta.env?.VITE_SCAN_CONCURRENCY ?? DEFAULT_SCAN_CONCURRENCY),
    Math.max(1, rpc.healthyCount()),
  );
  log.info('custom-erc20', `running ${totalRanges} chunks at concurrency=${limit}`);

  // Per candidate token, remember:
  //   - the EARLIEST mint-to-user block (== closest to deploy time)
  //   - the cumulative mint-to-user amount (sum across multiple Transfer
  //     events from zero, e.g. mint-on-claim contracts that drip to deployer)
  // We aggregate then apply the totalSupply % gate after metadata fetch.
  const seenTokens = new Map();
  for (const l of cachedLaunches) {
    if (l.token) seenTokens.set(l.token.toLowerCase(), {
      blockNumber: BigInt(l.deployedAt?.blockNumber || 0),
      txHash: l.deployedAt?.txHash || null,
      mintedToUser: BigInt(l.meta?.mintedToUser || 0),
      fromCache: true,
    });
  }
  let nextIdx = 0, completedRanges = 0;

  const worker = async () => {
    while (!signal?.aborted) {
      const i = nextIdx++;
      if (i >= ranges.length) return;
      const { from, to } = ranges[i];
      // Server-side filter: from = 0x0 (mint), to = user. Both indexed →
      // single topic-match on the RPC side, no full-firehose scan.
      const logs = await scanRange({ from: ZERO_ADDRESS, to: userAddr }, from, to, i + 1);
      for (const ev of logs) {
        const tok = safeAddress(ev.address);
        if (!tok) continue;
        const key = tok.toLowerCase();
        const txHash = HASH_RE_64.test(ev.transactionHash || '') ? ev.transactionHash : null;
        const value = BigInt(ev.args?.value || 0);
        const prev = seenTokens.get(key);
        if (!prev) {
          seenTokens.set(key, { blockNumber: ev.blockNumber, txHash, mintedToUser: value, fromCache: false });
        } else {
          prev.mintedToUser += value;
          // earlier-block wins as "deploy time"
          if (ev.blockNumber < prev.blockNumber || prev.blockNumber === 0n) {
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

  // Fetch metadata for every new candidate. Cached rows skip the network
  // round-trip (they already passed the threshold previously).
  const allTokens = [...seenTokens.keys()].map((k) => getAddress(k));
  const tokensNeedingMeta = allTokens.filter((t) => {
    const cachedRow = cachedLaunches.find((l) => l.token === t);
    return !cachedRow || !cachedRow.symbol;
  });
  const metaMap = tokensNeedingMeta.length ? await fetchMetadata(tokensNeedingMeta) : new Map();

  // Build final launch rows + apply the ≥50%-of-totalSupply gate. Cached
  // rows are kept as-is (they already passed). New rows must qualify.
  const merged = [];
  let dropped = 0;
  for (const t of allTokens) {
    const info = seenTokens.get(t.toLowerCase());
    const cachedRow = cachedLaunches.find((l) => l.token === t);
    if (cachedRow) {
      // already vetted in a prior scan — pass through, but update mintedToUser
      // and earliest-block in case we picked up more events this run.
      merged.push({
        ...cachedRow,
        deployedAt: { blockNumber: info.blockNumber, txHash: info.txHash || cachedRow.deployedAt?.txHash },
        meta: { ...(cachedRow.meta || {}), mintedToUser: info.mintedToUser.toString() },
      });
      continue;
    }
    const meta = metaMap.get(t);
    if (!meta?.ok || meta.totalSupply === 0n) {
      dropped++;
      continue; // not an ERC-20, or zero supply — skip
    }
    // bps = mintedToUser * 10000 / totalSupply. Reject if below threshold.
    const bps = (info.mintedToUser * 10000n) / meta.totalSupply;
    if (bps < DEPLOY_MINT_THRESHOLD_BPS) {
      dropped++;
      continue;
    }
    merged.push({
      pluginId: PLUGIN_ID,
      token: t,
      name: meta.name || '',
      symbol: meta.symbol || '',
      image: '', // arbitrary contracts have no canonical image source
      deployedAt: { blockNumber: info.blockNumber, txHash: info.txHash },
      links: [
        { label: 'basescan', url: CUSTOM_TOKEN_LINK(t),                       kind: 'protocol' },
        { label: 'scan',     url: `https://basescan.org/address/${t}`,        kind: 'explorer' },
        ...(info.txHash ? [{ label: 'tx', url: `https://basescan.org/tx/${info.txHash}`, kind: 'tx' }] : []),
      ],
      meta: {
        mintedToUser: info.mintedToUser.toString(),
        totalSupplyAtScan: meta.totalSupply.toString(),
        mintShareBps: bps.toString(),
      },
    });
  }

  if (signal?.aborted) {
    endDone({ launches: merged.length, aborted: true, droppedBelowThreshold: dropped });
    return merged;
  }
  writeCache(cacheKey, { tokens: merged, scannedToBlock: head });
  endDone({ launches: merged.length, newSinceCache: merged.length - cachedLaunches.length, droppedBelowThreshold: dropped });
  return merged;
}
