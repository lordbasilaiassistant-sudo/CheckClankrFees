// Structured debug log. Every interesting op pushes a record here.
// Visible at runtime via DebugPanel (auto-mounts when URL has ?debug=1
// or when localStorage.ccf_debug === '1'), and dumped to console with a
// stable prefix so browser DevTools filtering works.
//
// Design notes:
// - Ring buffer (LOG_CAP) so a long-running session can't OOM.
// - Subscribers re-render React panels via a tiny pub/sub (no extra deps).
// - Every log carries: ts, level, scope, msg, data, durMs (optional).
// - `time(scope, msg)` returns a `done(extra?)` thunk that logs the elapsed
//   ms — use it on every network/RPC call so we can see latency in the panel.

const LOG_CAP = 1000;
const buf = [];
const subs = new Set();

let nextId = 1;

function notify() {
  // shallow-copy so subscribers can rely on referential change for memo
  const snapshot = buf.slice();
  for (const fn of subs) {
    try { fn(snapshot); } catch (e) { console.error('[ccf] subscriber threw', e); }
  }
}

function push(level, scope, msg, data, durMs) {
  const rec = {
    id: nextId++,
    ts: Date.now(),
    level,
    scope: scope || 'app',
    msg: String(msg ?? ''),
    data: data === undefined ? null : safeClone(data),
    durMs: typeof durMs === 'number' ? durMs : null,
  };
  buf.push(rec);
  if (buf.length > LOG_CAP) buf.splice(0, buf.length - LOG_CAP);

  const prefix = `[ccf:${rec.scope}]`;
  const tail = rec.durMs != null ? ` (${rec.durMs.toFixed(1)}ms)` : '';
  const args = [prefix, rec.msg + tail];
  if (rec.data != null) args.push(rec.data);
  switch (level) {
    case 'error': console.error(...args); break;
    case 'warn': console.warn(...args); break;
    case 'info': console.info(...args); break;
    default: console.debug(...args);
  }

  notify();
  return rec;
}

function safeClone(v) {
  // BigInt / circular-safe shallow-ish clone for the panel
  try {
    return JSON.parse(JSON.stringify(v, (_k, val) =>
      typeof val === 'bigint' ? val.toString() + 'n' : val
    ));
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (scope, msg, data) => push('debug', scope, msg, data),
  info:  (scope, msg, data) => push('info',  scope, msg, data),
  warn:  (scope, msg, data) => push('warn',  scope, msg, data),
  error: (scope, msg, data) => push('error', scope, msg, data),
  /** time(scope, msg) → done(extraData?) → logs elapsed ms */
  time(scope, msg, data) {
    const started = performance.now();
    push('debug', scope, msg + ' …', data);
    return (extra, level = 'info') => {
      const durMs = performance.now() - started;
      return push(level, scope, msg + ' ✓', extra, durMs);
    };
  },
  /** Snapshot of current ring buffer */
  snapshot: () => buf.slice(),
  subscribe(fn) { subs.add(fn); fn(buf.slice()); return () => subs.delete(fn); },
  clear() { buf.length = 0; notify(); },
};

// Window-level error/promise hooks so silent failures still land in the panel.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    log.error('window', 'uncaught error', {
      message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    log.error('window', 'unhandled promise rejection', {
      reason: e.reason && (e.reason.message || String(e.reason)),
    });
  });
  // Expose for ad-hoc debugging in DevTools.
  window.__ccfLog = log;
}

/** Should we auto-mount the on-screen panel? */
export function debugPanelEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get('debug') === '1') return true;
    return window.localStorage?.getItem('ccf_debug') === '1';
  } catch {
    return false;
  }
}
