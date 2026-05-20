// React hook wrapping findTokensByDeployer. Handles:
//   - StrictMode double-mount via epoch counter (stale promises no-op)
//   - Immediate cache render via onCached
//   - Abort on address change / unmount
//   - Loading/error/progress state for the UI

import { useEffect, useRef, useState } from 'react';
import { findTokensByDeployer } from '../lib/clanker/scan.js';
import { log } from '../lib/debug.js';

export function useTokenScan(address) {
  const [tokens, setTokens] = useState([]);
  const [progress, setProgress] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const epochRef = useRef(0);

  useEffect(() => {
    if (!address) return;
    const epoch = ++epochRef.current;
    setTokens([]); setError(null); setProgress(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    setScanning(true);

    findTokensByDeployer(address, {
      signal: ctl.signal,
      onProgress: (p) => { if (epochRef.current === epoch) setProgress(p); },
      onCached: (cached) => {
        if (epochRef.current !== epoch) return;
        if (cached?.length) {
          setTokens(cached);
          log.info('list', `rendered ${cached.length} cached tokens immediately`);
        }
      },
    })
      .then((list) => {
        if (epochRef.current !== epoch) return;
        setTokens(list);
        log.info('list', `scan finished — ${list.length} token(s)`);
      })
      .catch((e) => {
        if (epochRef.current !== epoch) return;
        if (ctl.signal.aborted) return;
        log.error('list', 'scan failed', { message: e?.message });
        setError(e?.message || String(e));
      })
      .finally(() => {
        if (epochRef.current === epoch) setScanning(false);
      });

    return () => ctl.abort();
  }, [address]);

  const stop = () => abortRef.current?.abort();
  return { tokens, progress, scanning, error, stop };
}
