// React hook wrapping wagmi's useWriteContract + useWaitForTransactionReceipt
// for the Claim button. Single hook per token row so each row's pending /
// error state is independent.
//
// Flow:
//   1. claim() — opens wallet, user signs FeeLocker.claim(feeOwner, token)
//   2. status moves: idle → pending (in-wallet) → confirming (on-chain) → done
//   3. on success, fires onClaimed(token) so the parent can re-read just
//      this row's claimable amount (which should now be 0)

import { useCallback, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { buildClaimRequest } from '../lib/clanker/claim.js';
import { log } from '../lib/debug.js';

export function useClaimFees({ feeOwner, token, onClaimed }) {
  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: receiptError } =
    useWaitForTransactionReceipt({ hash: txHash });

  const claim = useCallback(() => {
    if (!feeOwner || !token) return;
    log.info('claim', 'submitting FeeLocker.claim', { feeOwner, token });
    writeContract(buildClaimRequest({ feeOwner, token }));
  }, [feeOwner, token, writeContract]);

  useEffect(() => {
    if (isSuccess && txHash) {
      log.info('claim', 'claim confirmed', { token, txHash });
      onClaimed?.(token);
    }
  }, [isSuccess, txHash, token, onClaimed]);

  const status =
    isConfirming ? 'confirming'
    : isPending ? 'pending'
    : isSuccess ? 'done'
    : (writeError || receiptError) ? 'error'
    : 'idle';

  return {
    claim,
    reset,
    status,                  // 'idle' | 'pending' | 'confirming' | 'done' | 'error'
    txHash,
    error: writeError || receiptError || null,
  };
}
