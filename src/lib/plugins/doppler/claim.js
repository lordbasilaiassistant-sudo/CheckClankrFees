// Doppler claim. Wires the in-app claim button against the v1 locker
// (StreamableFeesLocker). v2 (StreamableFeesLockerV2) uses a different
// fee-accounting model entirely (no `beneficiariesClaims` mapping; claims
// happen via `collectFees(bytes32 poolId)`) and is NOT yet wired — the
// button will surface a clear error if all of a token's claimable lives
// on v2.
//
// Solidity source verified 2026-05-20:
//   https://raw.githubusercontent.com/whetstoneresearch/doppler/main/src/StreamableFeesLocker.sol
//   https://raw.githubusercontent.com/whetstoneresearch/doppler/main/src/StreamableFeesLockerV2.sol
//
// Key v1 facts that shape this code:
//   1) The drain function is `releaseFees(uint256 tokenId)` — keyed by
//      Uniswap V4 position tokenId, NOT by currency.
//   2) Inside `_releaseFees` the contract zeroes both
//      `beneficiariesClaims[msg.sender][poolKey.currency0]` AND
//      `beneficiariesClaims[msg.sender][poolKey.currency1]` of the position
//      pool — so one releaseFees() call drains BOTH currencies of that pool
//      for the caller.
//   3) `releaseFees` reverts if the caller is not in
//      `positions[tokenId].beneficiaries[]`.
//
// Discovery of the tokenId for the user happens in rewards.js (Lock-event
// scan + beneficiary filter). claim.js reads the cached breakdown via
// rewards.getCachedBreakdown(chainId, feeOwner, token).

import { parseAbi, getAddress } from 'viem';
import { DOPPLER } from './constants.js';
import { getCachedBreakdown } from './rewards.js';

export const supportsClaim = true;

export const V1_RELEASE_FEES_ABI = parseAbi([
  'function releaseFees(uint256 tokenId)',
]);

/** Build the wagmi writeContract request for a Doppler claim.
 *
 *  Sync — matches the buildClaimTx contract in ../types.js. Throws with a
 *  user-readable message if we don't have enough state to build the tx
 *  (e.g. rewards haven't been fetched yet, or the claimable lives entirely
 *  on the v2 locker which we don't yet support).
 */
export function buildClaimTx({ launch, feeOwner, chainId = 8453 }) {
  const cfg = DOPPLER[chainId];
  if (!cfg) throw new Error(`Doppler: no config for chainId ${chainId}`);
  if (!launch?.token) throw new Error('Doppler: missing launch.token');
  if (!feeOwner) throw new Error('Doppler: missing feeOwner');

  const token = getAddress(launch.token);
  const owner = getAddress(feeOwner);

  const breakdown = getCachedBreakdown(chainId, owner, token);
  if (!breakdown) {
    throw new Error(
      'Doppler: claimable breakdown not yet loaded — refresh rewards and try again.'
    );
  }
  const v1 = BigInt(breakdown.v1 || 0n);
  const v2 = BigInt(breakdown.v2 || 0n);

  if (v1 === 0n && v2 > 0n) {
    throw new Error(
      'Doppler: this token\'s fees are held in StreamableFeesLockerV2, which uses a ' +
      'different claim flow (collectFees(poolId)) not yet supported in-app. ' +
      'Use doppler.lol to claim until the next release.'
    );
  }
  if (v1 === 0n && v2 === 0n) {
    throw new Error('Doppler: nothing claimable for this token right now.');
  }

  // v1 path — releaseFees(tokenId). We need a tokenId where the caller is a
  // beneficiary AND whose pool includes the currency this row represents.
  // rewards.js attaches the full candidate set; we pick the first. If the
  // user has multiple v1 positions involving different pools, a single
  // releaseFees() call may not drain everything — they'll need to click
  // again after refresh. Logged so it's debuggable.
  const candidates = Array.isArray(breakdown.tokenIdsV1) ? breakdown.tokenIdsV1 : [];
  if (!candidates.length) {
    throw new Error(
      'Doppler: could not locate the position tokenId for this claim. ' +
      'Try refreshing rewards — if it persists, claim via doppler.lol.'
    );
  }
  const tokenId = BigInt(candidates[0]);

  return {
    address: getAddress(cfg.streamableFeesLocker),
    abi: V1_RELEASE_FEES_ABI,
    functionName: 'releaseFees',
    args: [tokenId],
  };
}
