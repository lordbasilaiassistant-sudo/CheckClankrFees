// Error classification for the RPC aggregator. Two key questions:
//   - Is this error a CONTRACT REVERT? (RPC did its job — don't penalize)
//   - Is this error a CORS-style network rejection? (Endpoint will never work
//     from this origin — disable permanently for the session.)
//
// Getting these wrong was the root cause of "mainnet.base.org banned after
// 248 successes" in an earlier iteration.

import {
  ContractFunctionRevertedError,
  ContractFunctionExecutionError,
  ContractFunctionZeroDataError,
  BaseError,
} from 'viem';

/** A revert means the chain answered — the RPC is healthy. */
export function isContractRevert(err) {
  if (!err) return false;
  if (err instanceof ContractFunctionRevertedError) return true;
  if (err instanceof ContractFunctionExecutionError) return true;
  if (err instanceof ContractFunctionZeroDataError) return true;
  if (err instanceof BaseError) {
    const walked = err.walk?.((e) => (
      e instanceof ContractFunctionRevertedError ||
      e instanceof ContractFunctionExecutionError ||
      e instanceof ContractFunctionZeroDataError
    ));
    if (walked) return true;
  }
  const msg = (err.shortMessage || err.message || '').toLowerCase();
  if (msg.includes('execution reverted')) return true;
  if (msg.includes('reverted with') || msg.includes('revert reason')) return true;
  return false;
}

/** Browsers hide CORS details to prevent fingerprinting; we sniff the
 *  generic "Failed to fetch" family of messages. Conservative — false
 *  positives just mean an endpoint sits idle until next session. */
export function looksLikeCors(err) {
  const m = (err?.shortMessage || err?.message || '').toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('load failed') ||
    m.includes('networkerror') ||
    m.includes('cors') ||
    m.includes('access-control')
  );
}
