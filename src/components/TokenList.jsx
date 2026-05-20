import React, { useCallback, useMemo, useState } from 'react';
import TokenRow from './TokenRow.jsx';
import { useTokenScan } from '../hooks/useTokenScan.js';
import { useFeeRewards } from '../hooks/useFeeRewards.js';
import { PLUGINS } from '../lib/plugins/index.js';

// Container: merges scan + rewards across all enabled plugins. The user
// can filter by plugin via the chip strip at the top, and toggle
// "hide-empty" to focus on tokens with actual claimable balance (the
// "find forgotten money" mode).

export default function TokenList({ address }) {
  const { launches, scanning, error, stop } = useTokenScan(address);
  const launchKeys = useMemo(() => launches, [launches]);
  const { rewards, refresh } = useFeeRewards(address, launchKeys);
  const [pluginFilter, setPluginFilter] = useState('all'); // 'all' | pluginId
  const [hideZero, setHideZero] = useState(true);

  const visible = useMemo(() => {
    let v = launches;
    if (pluginFilter !== 'all') v = v.filter((l) => l.pluginId === pluginFilter);
    if (hideZero) v = v.filter((l) => {
      const r = rewards[l.token];
      if (r === undefined) return true;     // not loaded yet — show
      try { return BigInt(r.amount || 0) > 0n; } catch { return true; }
    });
    // Sort: claimable amount DESC (loaded first), then plugin id, then symbol
    return v.slice().sort((a, b) => {
      const ra = rewards[a.token]?.amount ?? 0n;
      const rb = rewards[b.token]?.amount ?? 0n;
      try {
        const A = BigInt(ra || 0), B = BigInt(rb || 0);
        if (A !== B) return B > A ? 1 : -1;
      } catch {}
      if (a.pluginId !== b.pluginId) return a.pluginId.localeCompare(b.pluginId);
      return (a.symbol || '').localeCompare(b.symbol || '');
    });
  }, [launches, rewards, pluginFilter, hideZero]);

  const counts = useMemo(() => {
    const out = { all: launches.length };
    for (const p of PLUGINS) out[p.id] = launches.filter((l) => l.pluginId === p.id).length;
    return out;
  }, [launches]);

  const totalClaimable = useMemo(() => {
    let sum = 0n;
    for (const l of launches) {
      try { sum += BigInt(rewards[l.token]?.amount || 0); } catch {}
    }
    return sum;
  }, [launches, rewards]);

  const handleClaimed = useCallback((token) => { refresh(token); }, [refresh]);

  return (
    <div className="list">
      <div className="list-hdr">
        <h2>
          {launches.length} launch{launches.length === 1 ? '' : 'es'}
          {totalClaimable > 0n && (
            <span className="dim small"> · est. claimable across all: see rows</span>
          )}
        </h2>
        {scanning && (
          <div className="prog">
            <span className="dim small">scanning…</span>
            <button className="btn ghost small" onClick={stop}>Stop</button>
          </div>
        )}
      </div>

      <div className="filter-strip">
        <FilterChip
          active={pluginFilter === 'all'}
          onClick={() => setPluginFilter('all')}
          label="all"
          count={counts.all}
        />
        {PLUGINS.map((p) => (
          <FilterChip
            key={p.id}
            active={pluginFilter === p.id}
            onClick={() => setPluginFilter(p.id)}
            label={p.name}
            count={counts[p.id] || 0}
            className={`plugin-${p.id}`}
          />
        ))}
        <label className="hide-zero">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
          hide empty (forgotten-money mode)
        </label>
      </div>

      {error && <div className="err">⚠ {error}</div>}

      {!scanning && visible.length === 0 && launches.length > 0 && (
        <div className="empty small">
          <p className="dim">
            All scanned launches have 0 claimable. {' '}
            <button className="btn ghost small inline" onClick={() => setHideZero(false)}>
              Show {launches.length} zero-balance row{launches.length === 1 ? '' : 's'}
            </button>
            {' '}or wait a bit — multicall reads are still landing.
          </p>
        </div>
      )}

      {!scanning && launches.length === 0 && !error && (
        <div className="empty small">
          <p>No launches found for <code>{address}</code> across {PLUGINS.length} plugin{PLUGINS.length === 1 ? '' : 's'}.</p>
        </div>
      )}

      {visible.length > 0 && (
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
              {visible.map((l) => (
                <TokenRow
                  key={`${l.pluginId}:${l.token}`}
                  launch={l}
                  reward={rewards[l.token]}
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

function FilterChip({ active, onClick, label, count, className = '' }) {
  return (
    <button
      type="button"
      className={`chip ${className} ${active ? 'active' : ''}`}
      onClick={onClick}
      title={`${count} launch${count === 1 ? '' : 'es'}`}
    >
      {label} <span className="chip-count">{count}</span>
    </button>
  );
}
