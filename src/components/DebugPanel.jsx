import React, { useEffect, useMemo, useState } from 'react';
import { log } from '../lib/debug.js';
import { rpc } from '../lib/rpc/index.js';

const LEVEL_COLOR = { debug: '#9aa', info: '#7cd', warn: '#fc6', error: '#f77' };

export default function DebugPanel({ onClose }) {
  const [entries, setEntries] = useState(log.snapshot());
  const [rpcs, setRpcs] = useState(rpc.snapshot());
  const [filter, setFilter] = useState('');
  const [minLevel, setMinLevel] = useState('debug');

  useEffect(() => log.subscribe(setEntries), []);
  useEffect(() => rpc.subscribe(setRpcs), []);

  const filtered = useMemo(() => {
    const lvlOrder = { debug: 0, info: 1, warn: 2, error: 3 };
    const min = lvlOrder[minLevel] ?? 0;
    const q = filter.trim().toLowerCase();
    return entries
      .filter((e) => lvlOrder[e.level] >= min)
      .filter((e) => !q || `${e.scope} ${e.msg}`.toLowerCase().includes(q))
      .slice(-300)
      .reverse();
  }, [entries, filter, minLevel]);

  return (
    <div className="dbg">
      <div className="dbg-hdr">
        <b>Debug</b>
        <input
          className="dbg-filter"
          placeholder="filter scope/msg…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select value={minLevel} onChange={(e) => setMinLevel(e.target.value)}>
          <option value="debug">all</option>
          <option value="info">info+</option>
          <option value="warn">warn+</option>
          <option value="error">error only</option>
        </select>
        <button className="btn ghost small" onClick={() => log.clear()}>clear</button>
        <button className="btn ghost small" onClick={onClose}>✕</button>
      </div>

      <details className="dbg-rpc" open>
        <summary>RPC pool ({rpcs.length}) — {rpcs.filter(r => r.state === 'healthy').length} healthy</summary>
        <table className="dbg-rpc-tbl">
          <colgroup>
            <col style={{ width: '36%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
          </colgroup>
          <thead>
            <tr><th>host</th><th>state</th><th className="num">ok</th><th className="num">fail</th><th className="num" title="in-flight">▶</th><th className="num">ms</th></tr>
          </thead>
          <tbody>
            {rpcs.map((e) => (
              <tr key={e.url} className={`rpc-${e.state}`} title={e.lastError ? `last error: ${e.lastError}` : e.url}>
                <td>{host(e.url)}{e.isPrivate ? ' 🔑' : ''}</td>
                <td>{statePill(e.state)}</td>
                <td className="num">{e.ok}</td>
                <td className="num">{e.fail}</td>
                <td className="num">{e.inFlight || ''}</td>
                <td className="num">{e.emaMs?.toFixed(0) ?? e.lastMs?.toFixed(0) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div className="dbg-log">
        {filtered.map((e) => (
          <div key={e.id} className="dbg-row">
            <span className="dbg-time">{fmtTime(e.ts)}</span>
            <span className="dbg-level" style={{ color: LEVEL_COLOR[e.level] }}>{e.level}</span>
            <span className="dbg-scope">[{e.scope}]</span>
            <span className="dbg-msg">{e.msg}{e.durMs != null ? ` (${e.durMs.toFixed(1)}ms)` : ''}</span>
            {e.data != null && <pre className="dbg-data">{stringify(e.data)}</pre>}
          </div>
        ))}
        {filtered.length === 0 && <div className="dim small">No log entries match.</div>}
      </div>
    </div>
  );
}

function host(u) { try { return new URL(u).host; } catch { return u; } }
function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function stringify(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}
function statePill(s) {
  const map = {
    healthy: '🟢 healthy',
    cooling: '🟡 cooling',
    banned: '🔴 banned',
    disabled: '⛔ cors',
  };
  return <span className={`pill ${s}`}>{map[s] || s}</span>;
}
