import React, { useCallback, useMemo, useState } from 'react';
import { formatEther } from 'viem';
import TokenRow from './TokenRow.jsx';
import { useTokenScan } from '../hooks/useTokenScan.js';
import { useFeeRewards } from '../hooks/useFeeRewards.js';
import { PLUGINS } from '../lib/plugins/index.js';

// Container. Three responsibilities:
//   1. Run the scan + rewards hooks.
//   2. Provide the user with filtering, sorting, and rescan controls.
//   3. Compute the totals that headline the page ("you have X ETH waiting").

export default function TokenList({ address }) {
  const { launches, perPluginStatus, scanning, error, stop, rescan } = useTokenScan(address);
  const launchKeys = useMemo(() => launches, [launches]);
  const { rewards, refresh } = useFeeRewards(address, launchKeys);
  const [pluginFilter, setPluginFilter] = useState('all');
  const [hideZero, setHideZero] = useState(true);

  const visible = useMemo(() => {
    let v = launches;
    if (pluginFilter !== 'all') v = v.filter((l) => l.pluginId === pluginFilter);
    if (hideZero) v = v.filter((l) => {
      const r = rewards[l.token];
      if (r === undefined) return true;
      try { return BigInt(r.amount || 0) > 0n; } catch { return true; }
    });
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

  // Total claimable, separated by "the rewards lookup has finished and
  // returned a real number" vs "still loading". The hero shows the
  // confirmed total and a "+ X loading" suffix when reads are in flight.
  const { totalConfirmed, totalPendingReads, tokensWithClaim, allReadsLanded } = useMemo(() => {
    let sum = 0n;
    let pending = 0;
    let withClaim = 0;
    for (const l of launches) {
      const r = rewards[l.token];
      if (r === undefined) { pending++; continue; }
      try {
        const amt = BigInt(r.amount || 0);
        if (amt > 0n) { sum += amt; withClaim++; }
      } catch {}
    }
    return { totalConfirmed: sum, totalPendingReads: pending, tokensWithClaim: withClaim, allReadsLanded: pending === 0 };
  }, [launches, rewards]);

  const handleClaimed = useCallback((token) => { refresh(token); }, [refresh]);

  // Plugin status helpers.
  const anyScanning = scanning;
  const everyPluginDone = PLUGINS.every((p) => perPluginStatus[p.id]?.state === 'done');

  return (
    <div className="list">
      <Hero
        total={totalConfirmed}
        pendingReads={totalPendingReads}
        tokensWithClaim={tokensWithClaim}
        totalLaunches={launches.length}
        scanning={anyScanning}
        allReadsLanded={allReadsLanded}
      />

      <div className="list-controls">
        <div className="filter-strip">
          <FilterChip
            active={pluginFilter === 'all'}
            onClick={() => setPluginFilter('all')}
            label="all"
            count={counts.all}
            status={anyScanning ? 'scanning' : 'done'}
          />
          {PLUGINS.map((p) => (
            <FilterChip
              key={p.id}
              active={pluginFilter === p.id}
              onClick={() => setPluginFilter(p.id)}
              label={p.name}
              count={counts[p.id] || 0}
              status={perPluginStatus[p.id]?.state}
              progress={perPluginStatus[p.id]}
              className={`plugin-${p.id}`}
            />
          ))}
        </div>

        <div className="list-actions">
          <label className="hide-zero" title="When checked, rows with 0 claimable are hidden so the screen only shows what you can actually grab.">
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
            <span>only show $$$</span>
          </label>
          {anyScanning ? (
            <button className="btn ghost small" onClick={stop} title="Stop the in-progress scan">Stop</button>
          ) : (
            <>
              <button className="btn ghost small" onClick={() => rescan()} title="Re-run the scan from the cached head block">Rescan</button>
              <button className="btn ghost small" onClick={() => rescan({ wipeCache: true })} title="Wipe the cache and walk full history (slow first run, then fast on subsequent visits)">
                Scan deeper
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="err">⚠ {error}</div>}

      {!scanning && launches.length === 0 && !error && (
        <div className="empty small">
          <p>
            No launches found across {PLUGINS.length} plugin{PLUGINS.length === 1 ? '' : 's'} for <code>{shortAddr(address)}</code> in the default window.
          </p>
          <p className="dim">
            Try <button className="btn ghost small inline" onClick={() => rescan({ wipeCache: true })}>scan deeper</button> to walk full protocol history.
          </p>
        </div>
      )}

      {launches.length > 0 && visible.length === 0 && (
        <div className="empty small">
          <p className="dim">
            Found {launches.length} launch{launches.length === 1 ? '' : 'es'} but all show 0 claimable.{' '}
            <button className="btn ghost small inline" onClick={() => setHideZero(false)}>
              Show all anyway
            </button>
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th></th>
                <th>Token</th>
                <th className="claim-col">Claimable</th>
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

function Hero({ total, pendingReads, tokensWithClaim, totalLaunches, scanning, allReadsLanded }) {
  const eth = formatTrimmed(total);
  const hasMoney = total > 0n;

  let subtitle;
  if (scanning && totalLaunches === 0) {
    subtitle = 'Scanning your wallet across every supported launcher…';
  } else if (scanning && totalLaunches > 0) {
    subtitle = `Found ${totalLaunches} launch${totalLaunches === 1 ? '' : 'es'} so far — still scanning.`;
  } else if (!allReadsLanded) {
    subtitle = `Reading claimable balances for ${totalLaunches} launch${totalLaunches === 1 ? '' : 'es'}…`;
  } else if (hasMoney) {
    subtitle = `Across ${tokensWithClaim} token${tokensWithClaim === 1 ? '' : 's'} out of ${totalLaunches} scanned.`;
  } else if (totalLaunches > 0) {
    subtitle = `${totalLaunches} launch${totalLaunches === 1 ? '' : 'es'} scanned — nothing claimable right now.`;
  } else {
    subtitle = 'No launches found in the default 30-day window.';
  }

  return (
    <div className={'hero' + (hasMoney ? ' has-money' : '') + (scanning ? ' is-scanning' : '')}>
      <div className="hero-amount">
        <span className="hero-label">You have</span>
        <span className="hero-eth">
          <span className="hero-eth-num">{hasMoney ? eth : '—'}</span>
          <span className="hero-eth-unit">{hasMoney ? ' ETH' : ''}</span>
        </span>
        <span className="hero-label">waiting</span>
      </div>
      <div className="hero-sub">{subtitle}</div>
      {pendingReads > 0 && allReadsLanded === false && (
        <div className="hero-pending dim small">…{pendingReads} balance read{pendingReads === 1 ? '' : 's'} still in flight</div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count, status, progress, className = '' }) {
  // Visual states:
  //   scanning  → spinner + "X / Y" if total ranges known, else just spinner
  //   done      → count
  //   error     → red dot + count
  const isScanning = status === 'scanning';
  const isError = status === 'error';
  const pct = progress?.totalRanges ? Math.min(100, Math.floor((progress.completedRanges / progress.totalRanges) * 100)) : null;
  return (
    <button
      type="button"
      className={`chip ${className} ${active ? 'active' : ''} chip-${status || 'idle'}`}
      onClick={onClick}
      title={isScanning && progress?.totalRanges ? `${progress.completedRanges}/${progress.totalRanges} chunks scanned` : `${count} launch${count === 1 ? '' : 'es'}`}
    >
      {isScanning && <span className="chip-spin" aria-hidden="true">◌</span>}
      {isError && <span className="chip-err" aria-hidden="true">!</span>}
      <span className="chip-label">{label}</span>
      <span className="chip-count">{isScanning && pct != null ? `${pct}%` : count}</span>
    </button>
  );
}

function formatTrimmed(wei) {
  try {
    const eth = formatEther(BigInt(wei || 0));
    if (eth === '0') return '0';
    // Trim trailing zeros + dot. Always show at least 4 sig figs after the
    // decimal so dust amounts (0.00001234) don't collapse to "0".
    const trimmed = eth.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    return trimmed;
  } catch { return '—'; }
}

function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''; }
