// Plugin-aware token scanner. Spawns one scan per plugin in parallel and
// merges the results into a single flat list of launches tagged with
// `pluginId`. The component can then filter/group by plugin in the UI.

import { useEffect, useRef, useState } from 'react';
import { PLUGINS } from '../lib/plugins/index.js';
import { rpc } from '../lib/rpc/index.js';
import { log } from '../lib/debug.js';
import { DEFAULT_SCAN_CONCURRENCY } from '../constants.js';

export function useTokenScan(address, { chainId = 8453 } = {}) {
  const [launches, setLaunches] = useState([]);            // flat: [{pluginId, token, ...}]
  const [perPluginProgress, setPerPluginProgress] = useState({});
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const epochRef = useRef(0);

  useEffect(() => {
    if (!address) return;
    const epoch = ++epochRef.current;
    setLaunches([]); setError(null); setPerPluginProgress({});
    const ctl = new AbortController();
    abortRef.current = ctl;
    setScanning(true);

    const plugins = PLUGINS.filter((p) => p.chains.includes(chainId));
    // Share a total concurrency budget across plugins. Otherwise N plugins ×
    // M workers each = N·M parallel calls saturating the pool. We give
    // each plugin floor(totalBudget / plugins.length), min 1.
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

    // Per-plugin results so a single plugin's progress merges in without
    // racing the others.
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
            log.info('list', `${p.id}: rendered ${cached.length} cached`);
          },
          onProgress: (prog) => {
            if (epochRef.current !== epoch) return;
            setPerPluginProgress((prev) => ({ ...prev, [p.id]: prog }));
          },
        });
        if (epochRef.current !== epoch) return;
        perPlugin.set(p.id, list);
        setLaunches(flatten(perPlugin));
        log.info('list', `${p.id}: scan finished — ${list.length} launches`);
      } catch (e) {
        if (epochRef.current !== epoch) return;
        if (ctl.signal.aborted) return;
        log.error('list', `${p.id} scan failed`, { message: e?.message });
        // Don't propagate to top-level error — one plugin failing shouldn't
        // hide the others. UI shows partial results + a per-plugin error.
      }
    });

    Promise.all(tasks).finally(() => {
      if (epochRef.current === epoch) setScanning(false);
    });

    return () => ctl.abort();
  }, [address, chainId]);

  const stop = () => abortRef.current?.abort();
  return { launches, perPluginProgress, scanning, error, stop };
}

function flatten(perPlugin) {
  const out = [];
  for (const list of perPlugin.values()) out.push(...list);
  return out;
}
