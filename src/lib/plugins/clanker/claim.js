import { parseAbi, getAddress } from 'viem';
import { CLANKER_V4 } from './constants.js';

export const FEE_LOCKER_CLAIM_ABI = parseAbi([
  'function claim(address feeOwner, address token)',
]);

/** Per-token claim — FeeLocker.claim(feeOwner, token). msg.sender doesn't
 *  have to equal feeOwner; funds always go to feeOwner. */
export function buildClaimTx({ launch, feeOwner, chainId = 8453 }) {
  const cfg = CLANKER_V4[chainId];
  return {
    address: getAddress(cfg.feeLocker),
    abi: FEE_LOCKER_CLAIM_ABI,
    functionName: 'claim',
    args: [getAddress(feeOwner), getAddress(launch.token)],
  };
}
