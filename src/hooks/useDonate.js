// Native-ETH donation hook. Wraps wagmi's useSendTransaction +
// useWaitForTransactionReceipt. No contract call — just `value` to a fixed
// public address. Per-row status pill identical to useClaimFees so the UX
// reads the same.

import { useCallback, useEffect } from 'react';
import { parseEther, getAddress } from 'viem';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { DONATE_ADDRESS } from '../constants.js';
import { log } from '../lib/debug.js';

export function useDonate({ onSent } = {}) {
  const { sendTransaction, data: txHash, isPending, error: sendError, reset } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess, error: receiptError } =
    useWaitForTransactionReceipt({ hash: txHash });

  /** @param {string} amountEth — decimal string, e.g. '0.01'. */
  const donate = useCallback((amountEth) => {
    if (!amountEth) return;
    let value;
    try { value = parseEther(String(amountEth)); }
    catch (e) {
      log.warn('donate', 'invalid amount, skipping', { amountEth, msg: e?.message });
      return;
    }
    if (value <= 0n) return;
    log.info('donate', 'sending donation', { to: DONATE_ADDRESS, amountEth, wei: value.toString() });
    sendTransaction({ to: getAddress(DONATE_ADDRESS), value });
  }, [sendTransaction]);

  useEffect(() => {
    if (isSuccess && txHash) {
      log.info('donate', 'donation confirmed', { txHash });
      onSent?.(txHash);
    }
  }, [isSuccess, txHash, onSent]);

  const status =
    isConfirming ? 'confirming'
    : isPending ? 'pending'
    : isSuccess ? 'done'
    : (sendError || receiptError) ? 'error'
    : 'idle';

  return {
    donate,
    reset,
    status,
    txHash,
    error: sendError || receiptError || null,
  };
}
