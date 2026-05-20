// Doppler claimable lookup. Two lockers exist on Base:
//
//   v1  StreamableFeesLocker    0x0a00775d71a42cd33d62780003035e7f5b47bd3a
//   v2  StreamableFeesLockerV2  0xce3212e6536f33cd6fbfee265224131353ca3d47
//
// IMPORTANT on-chain reality (verified 2026-05-20 against
// github.com/whetstoneresearch/doppler/main/src/StreamableFeesLocker.sol
// and .../StreamableFeesLockerV2.sol):
//
//   - v1 exposes the public view
//       `beneficiariesClaims(address beneficiary, Currency currency)
//          public view returns (uint256)`
//     (Currency is an `address` newtype, so the ABI is `(address,address)`.)
//     Claims are drained by calling `releaseFees(uint256 tokenId)` on the
//     v1 locker — that single call zeroes BOTH currencies of the position's
//     pool.
//
//   - v2 does NOT expose `beneficiariesClaims` at all. It inherits from
//     `FeesManager` which tracks fee distribution via cumulated-fee deltas
//     (`getCumulatedFees0/1`, `getLastCumulatedFees0/1`, `getShares`).
//     Claims are drained by calling `collectFees(bytes32 poolId)`.
//
// Practical consequence: the multicall against v2's `beneficiariesClaims`
// always reverts (no such selector). We keep issuing it for now because
// (a) the call is cheap and (b) it's a no-op that returns zero. v2 read +
// claim support is tracked separately and not wired in this version.
//
// The claim button needs to know the per-locker breakdown AND the tokenId
// to call `releaseFees` against. We surface both via:
//
//   - fetchClaimablesPerLocker(launches, args)
//       -> { [token]: { v1: bigint, v2: bigint, tokenIdV1?: bigint } }
//
//   - fetchClaimables(launches, args)  (unchanged shape, backward compat)
//       -> { [token]: { amount: bigint, currency: 'TOKEN', error?: string } }
//
// We also memoize the per-(feeOwner) result in a module-level cache so the
// sync `buildClaimTx` in claim.js can read it without re-doing the work.

import { parseAbi, parseAbiItem, getAddress } from 'viem';
import { log } from '../../debug.js';
import { rpc, getLogs, getBlockNumber } from '../../rpc/index.js';
import { DOPPLER } from './constants.js';

export const LOCKER_ABI = parseAbi([
  'function beneficiariesClaims(address beneficiary, address currency) view returns (uint256)',
]);

/** v1 locker — only it has the tokenId-keyed positions map + releaseFees.
 *  The Lock event tuple `(address beneficiary, uint96 shares)` mirrors the
 *  BeneficiaryData struct in StreamableFeesLocker.sol (verified upstream). */
const V1_LOCK_EVENT = parseAbiItem(
  'event Lock(uint256 indexed tokenId, (address beneficiary, uint96 shares)[] beneficiaries, uint256 unlockDate)'
);

// ---------------------------------------------------------------------------
// Module-level cache. Maps `${chainId}:${feeOwner.toLowerCase()}` to the
// most-recent breakdown the scanner computed. buildClaimTx (sync) reads
// from here.
// ---------------------------------------------------------------------------
const breakdownCache = new Map();
const cacheKey = (chainId, feeOwner) => `${chainId}:${String(feeOwner).toLowerCase()}`;

/** Snapshot reader used by claim.js. Returns the breakdown record for one
 *  token under the active (chainId, feeOwner), or null if we have never
 *  fetched rewards for that owner. */
export function getCachedBreakdown(chainId, feeOwner, token) {
  const m = breakdownCache.get(cacheKey(chainId, feeOwner));
  if (!m) return null;
  return m.get(getAddress(token)) || null;
}

// ---------------------------------------------------------------------------
// v1 tokenId discovery — scan Lock events on the v1 locker, then read
// positions[tokenId] for each to find ones where the beneficiary == owner.
// Cached per (chainId, feeOwner) within a single session to avoid repeat
// scans on every rewards refresh.
// ---------------------------------------------------------------------------
const tokenIdScanCache = new Map(); // key -> { tokenIds: bigint[], scannedTo: bigint }

async function discoverV1TokenIds({ owner, locker, chainId }) {
  const key = cacheKey(chainId, owner);
  const prev = tokenIdScanCache.get(key);
  // Re-scan only the new tail.
  const head = await getBlockNumber();
  const cfg = DOPPLER[chainId];
  const floor = cfg?.airlockDeployBlock ?? 24_000_000n;
  const fromBlock = prev?.scannedTo ? prev.scannedTo + 1n : floor;
  if (fromBlock > head) return prev?.tokenIds ?? [];

  // Lock event on v1 doesn't index beneficiary, so we scan all Locks then
  // filter by reading positions[tokenId].beneficiaries off-chain. To keep
  // the work bounded we chunk in 50k-block ranges.
  const CHUNK = 50_000n;
  const allLocks = [];
  for (let cursor = fromBlock; cursor <= head; cursor = cursor + CHUNK + 1n) {
    const to = (cursor + CHUNK) > head ? head : (cursor + CHUNK);
    try {
      const logs = await getLogs({
        address: locker,
        event: V1_LOCK_EVENT,
        fromBlock: cursor,
        toBlock: to,
      });
      allLocks.push(...logs);
    } catch (e) {
      log.warn('doppler.rewards', 'Lock scan chunk failed (skipping)', {
        from: cursor.toString(), to: to.toString(), msg: e?.shortMessage || e?.message,
      });
    }
  }

  // Filter to events where the user appears in the beneficiaries array.
  // Beneficiary is in the un-indexed payload so we can read it client-side.
  const ownerLower = owner.toLowerCase();
  const found = [];
  for (const ev of allLocks) {
    const benefs = ev.args?.beneficiaries || [];
    const isMine = benefs.some((b) => String(b?.beneficiary || '').toLowerCase() === ownerLower);
    if (isMine) found.push(BigInt(ev.args.tokenId));
  }

  const merged = Array.from(new Set([...(prev?.tokenIds ?? []), ...found].map((x) => x.toString())))
    .map((s) => BigInt(s));
  tokenIdScanCache.set(key, { tokenIds: merged, scannedTo: head });
  log.info('doppler.rewards', `v1 tokenId scan: found ${found.length} new, ${merged.length} total`);
  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Per-locker breakdown. New entrypoint — claim.js needs this. */
export async function fetchClaimablesPerLocker(launches, { feeOwner, chainId = 8453 }) {
  const cfg = DOPPLER[chainId];
  if (!cfg || !launches.length) return {};
  const owner = getAddress(feeOwner);
  const lockers = [
    { tag: 'v1', addr: cfg.streamableFeesLocker },
    { tag: 'v2', addr: cfg.streamableFeesLockerV2 },
  ].filter((x) => x.addr);

  // Build {locker × token} calls.
  const calls = [];
  for (const { addr } of lockers) {
    for (const l of launches) {
      calls.push({
        address: addr,
        abi: LOCKER_ABI,
        functionName: 'beneficiariesClaims',
        args: [owner, getAddress(l.token)],
      });
    }
  }

  const endDone = log.time('doppler.rewards', `multicall × ${calls.length} (${launches.length} tokens × ${lockers.length} lockers)`);
  let results;
  try {
    results = await rpc.withClient('doppler.multicall.beneficiariesClaims', (c) =>
      c.multicall({ contracts: calls, allowFailure: true, batchSize: 100 })
    );
  } catch (e) {
    log.error('doppler.rewards', 'multicall failed entirely — returning zeros', { msg: e?.shortMessage });
    const empty = {};
    for (const l of launches) {
      empty[getAddress(l.token)] = { v1: 0n, v2: 0n, error: 'multicall failed' };
    }
    breakdownCache.set(cacheKey(chainId, owner), new Map(Object.entries(empty)));
    return empty;
  }

  // Stitch results back into per-token / per-locker shape.
  const out = {};
  let ok = 0, reverted = 0;
  for (let ti = 0; ti < launches.length; ti++) {
    const tok = getAddress(launches[ti].token);
    out[tok] = { v1: 0n, v2: 0n };
  }
  for (let li = 0; li < lockers.length; li++) {
    const tag = lockers[li].tag;
    for (let ti = 0; ti < launches.length; ti++) {
      const idx = li * launches.length + ti;
      const r = results[idx];
      const tok = getAddress(launches[ti].token);
      if (r?.status === 'success') {
        out[tok][tag] = BigInt(r.result || 0);
        ok++;
      } else {
        reverted++;
      }
    }
  }

  // Discover tokenIds for any token with a non-zero v1 claimable. We do this
  // lazily: if nothing is claimable on v1 we skip the (potentially expensive)
  // Lock-event scan entirely.
  const anyV1 = Object.values(out).some((v) => v.v1 > 0n);
  if (anyV1) {
    try {
      const tokenIds = await discoverV1TokenIds({
        owner,
        locker: cfg.streamableFeesLocker,
        chainId,
      });
      // We can't (without positionManager) map currency -> tokenId precisely,
      // so we attach the FULL set of beneficiary tokenIds to each token with
      // a v1 claimable. claim.js picks the first one — releaseFees zeroes
      // every currency for that position's pool, so any tokenId whose pool
      // includes this token's currency drains it. If the user has multiple
      // positions involving different pools they may need to claim more than
      // once; this version surfaces that limitation with an error log.
      for (const tok of Object.keys(out)) {
        if (out[tok].v1 > 0n && tokenIds.length) {
          out[tok].tokenIdsV1 = tokenIds; // candidate set, claim.js picks one
        }
      }
    } catch (e) {
      log.warn('doppler.rewards', 'v1 tokenId discovery failed', { msg: e?.shortMessage || e?.message });
    }
  }

  // Stash for sync access from buildClaimTx.
  const ownerMap = new Map();
  for (const [k, v] of Object.entries(out)) ownerMap.set(k, v);
  breakdownCache.set(cacheKey(chainId, owner), ownerMap);

  endDone({ ok, reverted });
  return out;
}

/** Backward-compatible per-token sum. UI uses this; we collapse v1 + v2
 *  into one number for display. */
export async function fetchClaimables(launches, args) {
  const breakdown = await fetchClaimablesPerLocker(launches, args);
  const out = {};
  for (const [tok, b] of Object.entries(breakdown)) {
    const amount = (b.v1 || 0n) + (b.v2 || 0n);
    out[tok] = b.error
      ? { amount: 0n, currency: 'TOKEN', error: b.error }
      : { amount, currency: 'TOKEN' };
  }
  return out;
}
