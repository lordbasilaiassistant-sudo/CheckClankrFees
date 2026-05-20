import React, { useCallback, useMemo } from 'react';
import TokenRow from './TokenRow.jsx';
import { useTokenScan } from '../hooks/useTokenScan.js';
import { useFeeRewards } from '../hooks/useFeeRewards.js';

// Container: orchestrates the scan hook + rewards hook, hands per-row data
// down to TokenRow / ClaimCell. No on-chain logic in here; that's all in
// /hooks and /lib.

export default function TokenList({ address }) {
  const { tokens, progress, scanning, error, stop } = useTokenScan(address);
  const tokenAddresses = useMemo(() => tokens.map((t) => t.token), [tokens]);
  const { rewards, refresh } = useFeeRewards(address, tokenAddresses);

  const handleClaimed = useCallback((token) => {
    // Re-read just the row that was claimed; balance should be 0 now.
    refresh(token);
  }, [refresh]);

  return (
    <div className="list">
      <div className="list-hdr">
        <h2>{tokens.length} token{tokens.length === 1 ? '' : 's'} you created</h2>
        {scanning && progress && (
          <div className="prog">
            <div className="prog-bar">
              <div className="prog-fill" style={{ width: pct(progress) + '%' }} />
            </div>
            <span className="dim small">
              {pct(progress).toFixed(0)}% · {progress.found} found
            </span>
            <button className="btn ghost small" onClick={stop}>Stop</button>
          </div>
        )}
      </div>

      {error && <div className="err">⚠ {error}</div>}

      {!scanning && tokens.length === 0 && !error && (
        <div className="empty small">
          <p>No Clanker v4 tokens found for <code>{address}</code>.</p>
          <p className="dim">
            Try widening the scan window: lower <code>VITE_SCAN_FROM_BLOCK</code> in <code>.env</code>.
          </p>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th></th>
                <th>Token</th>
                <th>Claimable</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <TokenRow
                  key={t.token}
                  token={t}
                  reward={rewards[t.token]}
                  feeOwner={address}
                  onClaimed={handleClaimed}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function pct(p) {
  if (!p || !p.total) return 0;
  return Math.min(100, (p.scanned / p.total) * 100);
}
