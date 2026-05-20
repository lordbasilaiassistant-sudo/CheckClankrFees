// Build the on-chain claim transaction for a (feeOwner, token) pair.
//
//   FeeLocker.claim(address feeOwner, address token)
//     — withdraws `feeOwner`'s `availableFees(feeOwner, token)` to feeOwner.
//     — msg.sender does NOT need to equal feeOwner; anyone can pay the gas
//       (funds always go to feeOwner). For this app, msg.sender === feeOwner
//       because the user clicks Claim from their own wallet.
//
// Returns a wagmi-compatible `writeContract` request. NO private key handling
// happens here — the React layer feeds this into useWriteContract and the
// user signs with their wallet.

import { parseAbi, getAddress } from 'viem';
import { FEE_LOCKER_BASE } from '../../constants.js';

export const FEE_LOCKER_CLAIM_ABI = parseAbi([
  'function claim(address feeOwner, address token)',
]);

export function buildClaimRequest({ feeOwner, token, locker = FEE_LOCKER_BASE }) {
  return {
    address: getAddress(locker),
    abi: FEE_LOCKER_CLAIM_ABI,
    functionName: 'claim',
    args: [getAddress(feeOwner), getAddress(token)],
  };
}
