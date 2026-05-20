// Per-row claim hook. Asks the launch's plugin for the write request, then
// passes it to wagmi. If the plugin doesn't yet support claim (Doppler v1
// being the example), the button never renders — see ClaimCell.

import { useCallback, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { pluginById } from '../lib/plugins/index.js';
import { log } from '../lib/debug.js';

export function useClaimFees({ launch, feeOwner, onClaimed, chainId = 8453 }) {
  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: receiptError } =
    useWaitForTransactionReceipt({ hash: txHash });

  const claim = useCallback(() => {
    if (!feeOwner || !launch) return;
    const plugin = pluginById(launch.pluginId);
    if (!plugin) return;
    let req;
    try { req = plugin.buildClaimTx({ launch, feeOwner, chainId }); }
    catch (e) {
      log.warn('claim', `plugin ${launch.pluginId} buildClaimTx threw`, { msg: e?.message });
      return;
    }
    log.info('claim', `submitting ${launch.pluginId} claim`, { token: launch.token });
    writeContract(req);
  }, [feeOwner, launch, chainId, writeContract]);

  useEffect(() => {
    if (isSuccess && txHash) {
      log.info('claim', 'claim confirmed', { token: launch?.token, txHash });
      onClaimed?.(launch?.token);
    }
  }, [isSuccess, txHash, launch, onClaimed]);

  const status =
    isConfirming ? 'confirming'
    : isPending ? 'pending'
    : isSuccess ? 'done'
    : (writeError || receiptError) ? 'error'
    : 'idle';

  return { claim, reset, status, txHash, error: writeError || receiptError || null };
}
