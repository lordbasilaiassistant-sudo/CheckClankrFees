import React from 'react';
import { formatEther } from 'viem';
import { useClaimFees } from '../hooks/useClaimFees.js';

// Renders the "Claimable" cell + the inline Claim button when a balance is
// available. Status pill replaces the button while the tx is in flight.

export default function ClaimCell({ feeOwner, token, reward, onClaimed }) {
  const { claim, status, txHash, error } = useClaimFees({ feeOwner, token, onClaimed });
  const display = formatAmount(reward);
  const canClaim = hasClaimableAmount(reward) && status === 'idle';

  return (
    <div className="claim-cell">
      <span className="mono claim-amount">{display}</span>
      {hasClaimableAmount(reward) && (
        <ClaimButton status={status} txHash={txHash} error={error} onClick={canClaim ? claim : undefined} />
      )}
    </div>
  );
}

function ClaimButton({ status, txHash, error, onClick }) {
  if (status === 'pending')    return <span className="claim-pill pending">signing…</span>;
  if (status === 'confirming') return <a className="claim-pill confirming" href={txHash ? `https://basescan.org/tx/${txHash}` : undefined} target="_blank" rel="noreferrer">confirming…</a>;
  if (status === 'done')       return <a className="claim-pill done" href={txHash ? `https://basescan.org/tx/${txHash}` : undefined} target="_blank" rel="noreferrer">claimed ✓</a>;
  if (status === 'error')      return <span className="claim-pill err" title={error?.shortMessage || error?.message || 'error'}>error</span>;
  return <button className="claim-pill claim-btn" onClick={onClick}>claim →</button>;
}

function hasClaimableAmount(r) {
  if (!r) return false;
  try { return BigInt(r.amount || 0) > 0n; } catch { return false; }
}

function formatAmount(r) {
  if (r === undefined) return <span className="dim">…</span>;
  if (r === null) return <span className="dim">n/a</span>;
  try {
    const wei = BigInt(r.amount || 0);
    if (wei === 0n) return <span className="dim">0</span>;
    const eth = formatEther(wei);
    const trimmed = eth.replace(/\.?0+$/, '') || '0';
    return <span title={`${wei.toString()} wei (paired token)`}>{trimmed}</span>;
  } catch {
    return '—';
  }
}
