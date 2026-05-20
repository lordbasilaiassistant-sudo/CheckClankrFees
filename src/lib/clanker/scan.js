// Find every Clanker v4 token where the given address is the tokenAdmin
// (= the deployer / token owner / default fee recipient at creation).
//
// Strategy: chunked eth_getLogs on the Clanker v4 factory's TokenCreated
// event, filtered server-side by the indexed tokenAdmin topic. Every chunk
// goes through the RPC aggregator's quorum read (k=2) so a single malicious
// public RPC can't forge events.
//
// Cache-aware: resumes at last-scanned head block via scanCache.

import { getAddress } from 'viem';
import { log } from '../debug.js';
import { rpc, getBlockNumber, getLogs } from '../rpc/index.js';
import { readCache, writeCache } from '../scanCache.js';
import {
  CLANKER_V4_FACTORY,
  FACTORY_DEPLOY_BLOCK,
  DEFAULT_SCAN_CHUNK,
  DEFAULT_SCAN_CONCURRENCY,
} from '../../constants.js';
import { TOKEN_CREATED_EVENT, parseTokenCreated } from './events.js';

const MIN_CHUNK = 500n;

function envBig(name, def) {
  const raw = import.meta.env?.[name];
  if (!raw) return def;
  try {
    const n = BigInt(String(raw));
    return n > 0n ? n : def;
  } catch {
    log.warn('scan', `bad env ${name}=${raw} — using default`);
    return def;
  }
}

/**
 * Scan for tokens where `address` is the tokenAdmin at creation time.
 *
 * @param {string} address — checksummed wallet address
 * @param {object} [opts]
 * @param {(p:object)=>void} [opts.onProgress]
 * @param {(cachedTokens:object[])=>void} [opts.onCached]
 * @param {AbortSignal}      [opts.signal]
 * @param {number}           [opts.concurrency]
 * @param {boolean}          [opts.useCache=true]
 * @returns {Promise<object[]>}
 */
export async function findTokensByDeployer(address, { onProgress, onCached, signal, concurrency, useCache = true } = {}) {
  const userAddr = getAddress(address);
  const factoryFloor = envBig('VITE_SCAN_FROM_BLOCK', FACTORY_DEPLOY_BLOCK);
  const chunkSize = envBig('VITE_SCAN_CHUNK', DEFAULT_SCAN_CHUNK);

  const cached = useCache ? readCache(userAddr) : null;
  const cachedTokens = cached?.tokens ?? [];
  if (cached) onCached?.(cachedTokens);

  const fromStart = cached?.scannedToBlock != null && cached.scannedToBlock >= factoryFloor
    ? cached.scannedToBlock + 1n
    : factoryFloor;

  const endDone = log.time('scan', 'scan TokenCreated by tokenAdmin', {
    address: userAddr,
    fromStart: fromStart.toString(),
    chunkSize: chunkSize.toString(),
    cached: cachedTokens.length,
  });

  const head = await getBlockNumber();
  log.info('scan', 'head block', { head: head.toString(), willScan: (head - fromStart).toString() });

  if (fromStart > head) {
    log.info('scan', 'cache is already current — nothing to scan');
    endDone({ tokens: cachedTokens.length, cacheHit: true });
    return cachedTokens;
  }

  // Build chunk list up front so concurrent workers can pull from it
  // in order and we get stable progress reporting.
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
  log.info('scan', `running ${totalRanges} chunks at concurrency=${limit}`);

  const tokens = [];
  const seen = new Set();
  for (const t of cachedTokens) if (t.token) seen.add(t.token.toLowerCase());
  let nextIdx = 0;
  let completedRanges = 0;

  const worker = async () => {
    while (!signal?.aborted) {
      const i = nextIdx++;
      if (i >= ranges.length) return;
      const { from, to } = ranges[i];
      const chunkLogs = await scanRange(userAddr, from, to, i + 1);
      for (const ev of chunkLogs) {
        const tokenAddr = ev.args?.tokenAddress;
        if (!tokenAddr || seen.has(tokenAddr.toLowerCase())) continue;
        seen.add(tokenAddr.toLowerCase());
        const parsed = parseTokenCreated(ev);
        if (parsed) tokens.push(parsed);
      }
      completedRanges++;
      onProgress?.({
        scanned: Number((BigInt(completedRanges) * (chunkSize + 1n))),
        total: Number(head - fromStart),
        fromBlock: from,
        toBlock: to,
        found: cachedTokens.length + tokens.length,
        completedRanges,
        totalRanges,
      });
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));

  if (signal?.aborted) {
    log.warn('scan', 'aborted by caller', { completedRanges });
    endDone({ tokens: cachedTokens.length + tokens.length, completedRanges, totalRanges, aborted: true });
    return [...cachedTokens, ...tokens];
  }

  const merged = [...cachedTokens, ...tokens];
  writeCache(userAddr, { tokens: merged, scannedToBlock: head });
  endDone({ tokens: merged.length, newThisRun: tokens.length, completedRanges, totalRanges });
  return merged;
}

/** Halving recursive chunk fetch — if even one chunk hits an RPC that rejects
 *  the range size, split in half and retry until MIN_CHUNK. The aggregator
 *  already handles per-call endpoint rotation; halving is for the "range
 *  too big" error specifically. */
async function scanRange(userAddr, from, to, label) {
  const endChunk = log.time('scan', `chunk #${label}`, { from: from.toString(), to: to.toString() });
  try {
    const logs = await getLogs({
      address: CLANKER_V4_FACTORY,
      event: TOKEN_CREATED_EVENT,
      args: { tokenAdmin: userAddr },
      fromBlock: from,
      toBlock: to,
    });
    endChunk({ matches: logs.length });
    return logs;
  } catch (e) {
    endChunk({ error: e?.message }, 'warn');
    const span = to - from;
    if (span <= MIN_CHUNK) {
      log.error('scan', `chunk ${from}-${to} failed at min size — skipping`, { error: e?.message });
      return [];
    }
    const mid = from + (span / 2n);
    log.warn('scan', 'halving range', { from: from.toString(), mid: mid.toString(), to: to.toString() });
    const [a, b] = await Promise.all([
      scanRange(userAddr, from, mid, `${label}a`),
      scanRange(userAddr, mid + 1n, to, `${label}b`),
    ]);
    return [...a, ...b];
  }
}
