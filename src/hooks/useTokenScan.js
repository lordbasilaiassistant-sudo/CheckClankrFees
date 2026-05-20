// Plugin-aware token scanner. Spawns one scan per plugin in parallel and
// merges the results into a single flat list of launches tagged with
// `pluginId`. The component can then filter/group by plugin in the UI.
//
// Public surface:
//   { launches, perPluginStatus, scanning, error, stop, rescan }
//
//   perPluginStatus[pluginId] = {
//     state: 'scanning' | 'done' | 'error',
//     scanned: number, total: number,        // block-weighted progress
//     completedRanges: number, totalRanges: number,
//     found: number,                          // how many launches surfaced so far
//   }
//
//   stop()      — abort the current scan; cached partial results stay.
//   rescan({ wipeCache })  — re-run with the same address. If wipeCache is
//                            true (e.g. "Scan deeper history" button), the
//                            plugin caches are cleared so we walk from
//                            scratch with whatever the current env says.

import { useCallback, useEffect, useRef, useState } from 'react';
import { PLUGINS } from '../lib/plugins/index.js';
import { rpc } from '../lib/rpc/index.js';
import { clearCache } from '../lib/scanCache.js';
import { log } from '../lib/debug.js';
import { DEFAULT_SCAN_CONCURRENCY } from '../constants.js';

export function useTokenScan(address, { chainId = 8453 } = {}) {
  const [launches, setLaunches] = useState([]);
  const [perPluginStatus, setPerPluginStatus] = useState({});
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const epochRef = useRef(0);
  // Bump this to force a re-run of the scan effect even if address hasn't changed.
  const [scanTrigger, setScanTrigger] = useState(0);

  useEffect(() => {
    if (!address) return;
    const epoch = ++epochRef.current;
    setLaunches([]); setError(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    setScanning(true);

    const plugins = PLUGINS.filter((p) => p.chains.includes(chainId));

    // Seed every plugin's status as `scanning` so the UI shows "..." pills
    // immediately instead of "0/0" until the first onProgress fires.
    const seedStatus = {};
    for (const p of plugins) seedStatus[p.id] = { state: 'scanning', scanned: 0, total: 0, completedRanges: 0, totalRanges: 0, found: 0 };
    setPerPluginStatus(seedStatus);

    const totalBudget = Math.max(
      1,
      Math.min(
        Number(import.meta.env?.VITE_SCAN_CONCURRENCY ?? DEFAULT_SCAN_CONCURRENCY),
        Math.max(1, rpc.healthyCount()),
      ),
    );
    const perPluginConcurrency = Math.max(1, Math.floor(totalBudget / plugins.length));
    log.info('list', `starting scan across ${plugins.length} plugin(s), total budget=${totalBudget}, per-plugin=${perPluginConcurrency}`, {
      plugins: plugins.map((p) => p.id),
    });

    const perPlugin = new Map(plugins.map((p) => [p.id, []]));

    const tasks = plugins.map(async (p) => {
      try {
        const list = await p.scanLaunches(address, {
          signal: ctl.signal,
          chainId,
          concurrency: perPluginConcurrency,
          onCached: (cached) => {
            if (epochRef.current !== epoch) return;
            if (!cached?.length) return;
            perPlugin.set(p.id, cached);
            setLaunches(flatten(perPlugin));
            setPerPluginStatus((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), found: cached.length } }));
            log.info('list', `${p.id}: rendered ${cached.length} cached`);
          },
          onProgress: (prog) => {
            if (epochRef.current !== epoch) return;
            setPerPluginStatus((prev) => ({
              ...prev,
              [p.id]: {
                state: 'scanning',
                scanned: prog.scanned || 0,
                total: prog.total || 0,
                completedRanges: prog.completedRanges || 0,
                totalRanges: prog.totalRanges || 0,
                found: prog.found ?? prev[p.id]?.found ?? 0,
              },
            }));
          },
        });
        if (epochRef.current !== epoch) return;
        perPlugin.set(p.id, list);
        setLaunches(flatten(perPlugin));
        setPerPluginStatus((prev) => ({
          ...prev,
          [p.id]: { ...(prev[p.id] || {}), state: 'done', found: list.length, scanned: prev[p.id]?.total ?? 0 },
        }));
        log.info('list', `${p.id}: scan finished — ${list.length} launches`);
      } catch (e) {
        if (epochRef.current !== epoch) return;
        if (ctl.signal.aborted) {
          setPerPluginStatus((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), state: 'done' } }));
          return;
        }
        log.error('list', `${p.id} scan failed`, { message: e?.message });
        setPerPluginStatus((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), state: 'error', error: e?.message || String(e) } }));
      }
    });

    Promise.all(tasks).finally(() => {
      if (epochRef.current === epoch) setScanning(false);
    });

    return () => ctl.abort();
  }, [address, chainId, scanTrigger]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const rescan = useCallback(({ wipeCache = false } = {}) => {
    if (!address) return;
    if (wipeCache) {
      // Wipe all plugin caches for this address+chain so we walk fresh.
      const plugins = PLUGINS.filter((p) => p.chains.includes(chainId));
      for (const p of plugins) {
        clearCache(`${p.id}:${chainId}:${address.toLowerCase()}`);
      }
      log.info('list', 'wiped caches for rescan-deeper', { address, chainId, plugins: plugins.map((p) => p.id) });
    } else {
      log.info('list', 'manual rescan');
    }
    setScanTrigger((n) => n + 1);
  }, [address, chainId]);

  return { launches, perPluginStatus, scanning, error, stop, rescan };
}

function flatten(perPlugin) {
  const out = [];
  for (const list of perPlugin.values()) out.push(...list);
  return out;
}
