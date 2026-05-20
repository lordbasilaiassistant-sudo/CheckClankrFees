import React from 'react';
import { formatEther } from 'viem';
import { useClaimFees } from '../hooks/useClaimFees.js';
import { pluginById } from '../lib/plugins/index.js';

// Claimable amount + inline Claim button (when supported by the plugin).
// Plugins can opt-out of the claim flow by exporting `supportsClaim = false`
// — in which case we render the amount and a "claim on <protocol>" link
// that defers to the plugin's external UI.

export default function ClaimCell({ launch, feeOwner, reward, onClaimed }) {
  const plugin = pluginById(launch.pluginId);
  const canClaimInApp = plugin?.supportsClaim !== false;
  const { claim, status, txHash, error } = useClaimFees({ launch, feeOwner, onClaimed });
  const display = formatAmount(reward, launch);
  const hasAmount = hasClaimableAmount(reward);

  return (
    <div className="claim-cell" data-positive={hasAmount ? 'true' : 'false'}>
      <span className="mono claim-amount">{display}</span>
      {hasAmount && launch.symbol && <span className="claim-unit">{launch.symbol}</span>}
      {hasAmount && canClaimInApp && (
        <ClaimButton
          status={status}
          txHash={txHash}
          error={error}
          onClick={status === 'idle' ? claim : undefined}
        />
      )}
      {hasAmount && !canClaimInApp && (
        <ExternalClaimLink launch={launch} />
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

function ExternalClaimLink({ launch }) {
  // Find the protocol link the plugin provided and route the user there.
  const proto = launch.links?.find((l) => l.kind === 'protocol');
  if (!proto) return null;
  return (
    <a className="claim-pill confirming" href={proto.url} target="_blank" rel="noreferrer" title={`Claim on ${proto.label}`}>
      claim on {proto.label} ↗
    </a>
  );
}

function hasClaimableAmount(r) {
  if (!r) return false;
  try { return BigInt(r.amount || 0) > 0n; } catch { return false; }
}

function formatAmount(r, launch) {
  if (r === undefined) return <span className="dim">…</span>;
  if (r === null) return <span className="dim">n/a</span>;
  try {
    const wei = BigInt(r.amount || 0);
    if (wei === 0n) return <span className="dim">0</span>;
    // All supported plugins emit 18-decimal tokens (Clanker enforces 18;
    // Doppler and custom-erc20 launches here are 18 by convention). If a
    // non-18 token ever sneaks in, the raw value is still in the tooltip.
    const eth = formatEther(wei);
    const trimmed = eth.replace(/\.?0+$/, '') || '0';
    const unit = launch?.symbol ? ` ${launch.symbol}` : '';
    return <span title={`${wei.toString()} (raw)${unit}`}>{trimmed}</span>;
  } catch {
    return '—';
  }
}
