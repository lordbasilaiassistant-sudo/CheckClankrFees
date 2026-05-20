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
  const { rewards, pairedRewards, refresh } = useFeeRewards(address, launchKeys);
  const [pluginFilter, setPluginFilter] = useState('all');
  const [hideZero, setHideZero] = useState(true);

  // Each paired-currency entry is rendered as a synthetic launch row so it
  // flows through the existing TokenRow + ClaimCell + claim button. Naming
  // mirrors the per-protocol pill style — "ETH (paired)" reads naturally
  // in the list and the claim flow uses the same `claim(owner, token)`
  // path the locker already exposes.
  const pairedLaunches = useMemo(() => pairedRewards.map((p) => ({
    pluginId: p.pluginId,
    token: p.token,
    name: `${p.symbol} (paired)`,
    symbol: p.symbol,
    image: '',
    deployedAt: { blockNumber: 0n, txHash: null },
    links: [
      { label: 'scan', url: `https://basescan.org/address/${p.token}`, kind: 'explorer' },
    ],
    meta: {
      isPaired: true,
      sourceLaunchCount: p.sourceLaunchCount,
      rawSymbol: p.rawSymbol,
    },
  })), [pairedRewards]);

  // Paired rewards merged into the rewards map so ClaimCell renders them
  // the same way it renders normal launches.
  const mergedRewards = useMemo(() => {
    const out = { ...rewards };
    for (const p of pairedRewards) {
      out[p.token] = { amount: p.amount, currency: 'PAIRED' };
    }
    return out;
  }, [rewards, pairedRewards]);

  const visible = useMemo(() => {
    // Merge paired rows into the list. They get pinned to the top because
    // they're typically the highest-value entry (ETH/WETH or stables).
    let v = [...pairedLaunches, ...launches];
    if (pluginFilter !== 'all') v = v.filter((l) => l.pluginId === pluginFilter);
    if (hideZero) v = v.filter((l) => {
      const r = mergedRewards[l.token];
      if (r === undefined) return true;
      try { return BigInt(r.amount || 0) > 0n; } catch { return true; }
    });
    return v.slice().sort((a, b) => {
      // Paired rows always sort to the top within their plugin group.
      const aPaired = !!a.meta?.isPaired;
      const bPaired = !!b.meta?.isPaired;
      if (aPaired !== bPaired) return aPaired ? -1 : 1;
      const ra = mergedRewards[a.token]?.amount ?? 0n;
      const rb = mergedRewards[b.token]?.amount ?? 0n;
      try {
        const A = BigInt(ra || 0), B = BigInt(rb || 0);
        if (A !== B) return B > A ? 1 : -1;
      } catch {}
      if (a.pluginId !== b.pluginId) return a.pluginId.localeCompare(b.pluginId);
      return (a.symbol || '').localeCompare(b.symbol || '');
    });
  }, [launches, pairedLaunches, mergedRewards, pluginFilter, hideZero]);

  const counts = useMemo(() => {
    const out = { all: launches.length };
    for (const p of PLUGINS) out[p.id] = launches.filter((l) => l.pluginId === p.id).length;
    return out;
  }, [launches]);

  // Claimable breakdown. Each launch's `availableFees` is denominated in
  // that launch's OWN token (THRYXUSD's fees are in THRYXUSD, PEPE's in
  // PEPE, etc.) — they aren't comparable, so the hero can't sum them.
  // We group by symbol and include paired-currency aggregates so e.g.
  // ETH from multiple WETH-paired pools shows as one hero row.
  const { byCurrency, totalPendingReads, tokensWithClaim, allReadsLanded } = useMemo(() => {
    const groups = new Map(); // symbol -> { amount, count }
    let pending = 0;
    let withClaim = 0;
    for (const l of launches) {
      const r = rewards[l.token];
      if (r === undefined) { pending++; continue; }
      try {
        const amt = BigInt(r.amount || 0);
        if (amt > 0n) {
          withClaim++;
          const key = (l.symbol || '').trim() || shortAddr(l.token);
          const g = groups.get(key) || { amount: 0n, count: 0 };
          g.amount += amt;
          g.count += 1;
          groups.set(key, g);
        }
      } catch {}
    }
    for (const p of pairedRewards) {
      if (p.amount > 0n) {
        withClaim++;
        const key = p.symbol;
        const g = groups.get(key) || { amount: 0n, count: 0 };
        g.amount += p.amount;
        g.count += 1;
        groups.set(key, g);
      }
    }
    return { byCurrency: groups, totalPendingReads: pending, tokensWithClaim: withClaim, allReadsLanded: pending === 0 };
  }, [launches, rewards, pairedRewards]);

  const handleClaimed = useCallback((token) => { refresh(token); }, [refresh]);

  // Plugin status helpers.
  const anyScanning = scanning;
  const everyPluginDone = PLUGINS.every((p) => perPluginStatus[p.id]?.state === 'done');

  return (
    <div className="list">
      <Hero
        byCurrency={byCurrency}
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
                  key={`${l.pluginId}:${l.token}${l.meta?.isPaired ? ':paired' : ''}`}
                  launch={l}
                  reward={mergedRewards[l.token]}
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

function Hero({ byCurrency, pendingReads, tokensWithClaim, totalLaunches, scanning, allReadsLanded }) {
  // Groups are per-symbol — sort by token count desc so the most-deployed
  // currency leads. We don't compare amounts across symbols; they're in
  // different units (1 ETH ≠ 1 THRYXUSD ≠ 1 PEPE).
  const groups = Array.from(byCurrency.entries())
    .map(([symbol, g]) => ({ symbol, amount: g.amount, count: g.count }))
    .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
  const hasMoney = groups.length > 0;
  const TOP = 3;
  const top = groups.slice(0, TOP);
  const moreCount = Math.max(0, groups.length - TOP);

  let subtitle;
  if (scanning && totalLaunches === 0) {
    subtitle = 'Scanning your wallet across every supported launcher…';
  } else if (scanning && totalLaunches > 0) {
    subtitle = `Found ${totalLaunches} launch${totalLaunches === 1 ? '' : 'es'} so far — still scanning.`;
  } else if (!allReadsLanded) {
    subtitle = `Reading claimable balances for ${totalLaunches} launch${totalLaunches === 1 ? '' : 'es'}…`;
  } else if (hasMoney) {
    subtitle = `Across ${tokensWithClaim} token${tokensWithClaim === 1 ? '' : 's'} out of ${totalLaunches} scanned. Each amount is denominated in its own token.`;
  } else if (totalLaunches > 0) {
    subtitle = `${totalLaunches} launch${totalLaunches === 1 ? '' : 'es'} scanned — nothing claimable right now.`;
  } else {
    subtitle = 'No launches found in the default 30-day window.';
  }

  return (
    <div className={'hero' + (hasMoney ? ' has-money' : '') + (scanning ? ' is-scanning' : '')}>
      <div className="hero-amount">
        <span className="hero-label">You have</span>
        {hasMoney ? (
          top.length === 1 ? (
            <span className="hero-eth">
              <span className="hero-eth-num" title={`${top[0].amount.toString()} (raw)`}>{formatTrimmed(top[0].amount)}</span>
              <span className="hero-eth-unit">{top[0].symbol}</span>
            </span>
          ) : (
            <span className="hero-eth hero-multi">
              {top.map((g) => (
                <span key={g.symbol} className="hero-multi-row">
                  <span className="hero-eth-num multi" title={`${g.amount.toString()} (raw)`}>{formatTrimmed(g.amount)}</span>
                  <span className="hero-eth-unit">{g.symbol}</span>
                </span>
              ))}
              {moreCount > 0 && <span className="hero-multi-more dim">+ {moreCount} more below</span>}
            </span>
          )
        ) : (
          <span className="hero-eth">
            <span className="hero-eth-num">—</span>
          </span>
        )}
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
