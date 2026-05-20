// Persist scan results in localStorage so a returning user only scans the
// blocks that have been mined since their last visit, not the full 15M-block
// history of the Clanker v4 factory.
//
// Cache shape (per address):
//   {
//     v: <version>,
//     tokens: [ { token, name, symbol, image, locker, blockNumber: string, txHash, ... } ],
//     scannedToBlock: "<bigint as decimal string>",
//     scannedAt: <unix ms>,
//   }
//
// Bigints serialize as strings (JSON can't). On read we re-parse.
// Bump CACHE_VERSION when the event shape or scan logic changes, to drop
// stale caches automatically.

import { log } from './debug.js';

// v3: a brittle JSON-equality comparator in withQuorum was causing
// getLogs results to be silently dropped, producing empty caches on v2
// for users that actually had launches. Forcing a re-scan with quorum
// disabled (DEFAULT_LOGS_QUORUM=1) restores correct results.
//
// v2: keys are now plugin × chain × address (was: only address).
// v1: legacy per-address cache from before the plugin refactor.
export const CACHE_VERSION = 3;
const PREFIX = 'ccf:scan:v';
const ENABLED = typeof window !== 'undefined' && !!window.localStorage;
// Drop caches older than this — self-heal in case a future version forgets
// to bump CACHE_VERSION but changes the shape. 30 days is generous for the
// "I checked my fees a month ago" returning user.
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function key(address) {
  return `${PREFIX}${CACHE_VERSION}:${address.toLowerCase()}`;
}

export function readCache(address) {
  if (!ENABLED) return null;
  try {
    const raw = window.localStorage.getItem(key(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== CACHE_VERSION) return null;
    const ageMs = parsed.scannedAt ? Date.now() - parsed.scannedAt : Infinity;
    if (ageMs > CACHE_MAX_AGE_MS) {
      log.info('cache', `cache older than ${Math.round(CACHE_MAX_AGE_MS / 86400000)}d — discarding`, {
        ageDays: Math.round(ageMs / 86400000),
      });
      try { window.localStorage.removeItem(key(address)); } catch {}
      return null;
    }
    const tokens = Array.isArray(parsed.tokens) ? parsed.tokens.map(rehydrateToken) : [];
    const scannedToBlock = BigInt(parsed.scannedToBlock || '0');
    log.info('cache', `loaded cache: ${tokens.length} tokens, scanned to block ${scannedToBlock}`, {
      ageMin: parsed.scannedAt ? Math.round(ageMs / 60000) : null,
    });
    return { tokens, scannedToBlock, scannedAt: parsed.scannedAt || 0 };
  } catch (e) {
    log.warn('cache', 'failed to read cache — discarding', { msg: e?.message });
    return null;
  }
}

export function writeCache(address, { tokens, scannedToBlock }) {
  if (!ENABLED) return;
  try {
    const payload = {
      v: CACHE_VERSION,
      tokens: tokens.map(serializeToken),
      scannedToBlock: scannedToBlock.toString(),
      scannedAt: Date.now(),
    };
    window.localStorage.setItem(key(address), JSON.stringify(payload));
    log.debug('cache', `wrote cache: ${tokens.length} tokens, head ${scannedToBlock}`);
  } catch (e) {
    log.warn('cache', 'failed to write cache (quota?)', { msg: e?.message });
  }
}

export function clearCache(address) {
  if (!ENABLED) return;
  try { window.localStorage.removeItem(key(address)); } catch {}
}

// JSON can't hold BigInts. The plugin Launch shape carries
// `deployedAt.blockNumber` as a BigInt — stringify on write, parse on read.
function serializeToken(t) {
  return {
    ...t,
    deployedAt: t.deployedAt
      ? { ...t.deployedAt, blockNumber: t.deployedAt.blockNumber?.toString() ?? null }
      : null,
  };
}

function rehydrateToken(t) {
  return {
    ...t,
    deployedAt: t.deployedAt
      ? { ...t.deployedAt, blockNumber: t.deployedAt.blockNumber != null ? BigInt(t.deployedAt.blockNumber) : null }
      : null,
  };
}
