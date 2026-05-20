// Plugin-aware claimable lookup. Groups launches by pluginId, calls each
// plugin's `fetchClaimables` (which uses its own multicall shape), then
// merges into a flat { [token]: Claimable } map.

import { useCallback, useEffect, useState } from 'react';
import { pluginById, PLUGINS } from '../lib/plugins/index.js';
import { log } from '../lib/debug.js';

export function useFeeRewards(address, launches, { chainId = 8453 } = {}) {
  const [rewards, setRewards] = useState({});
  // Paired-currency aggregates (e.g. WETH side of Clanker pools). Each entry:
  //   { pluginId, token, symbol, decimals, amount, sourceLaunchCount, isWeth }
  const [pairedRewards, setPairedRewards] = useState([]);

  const runPaired = useCallback(async (byPlugin) => {
    const results = await Promise.all([...byPlugin.entries()].map(async ([pid, list]) => {
      const p = pluginById(pid);
      if (!p || typeof p.fetchPairedClaimables !== 'function') return [];
      try {
        const arr = await p.fetchPairedClaimables(list, { feeOwner: address, chainId });
        return (arr || []).map((x) => ({ ...x, pluginId: pid }));
      } catch (e) {
        log.warn('rewards', `${pid} fetchPairedClaimables threw`, { msg: e?.message });
        return [];
      }
    }));
    return results.flat();
  }, [address, chainId]);

  const refresh = useCallback(async (onlyToken) => {
    if (!address || !launches?.length) return;
    const targets = onlyToken
      ? launches.filter((l) => l.token === onlyToken)
      : launches;
    const byPlugin = new Map();
    for (const l of targets) {
      const arr = byPlugin.get(l.pluginId) || [];
      arr.push(l);
      byPlugin.set(l.pluginId, arr);
    }
    log.info('rewards', `refreshing ${targets.length} launches across ${byPlugin.size} plugin(s)`);
    const [perLaunch, paired] = await Promise.all([
      Promise.all([...byPlugin.entries()].map(async ([pid, list]) => {
        const p = pluginById(pid);
        if (!p) return {};
        try { return await p.fetchClaimables(list, { feeOwner: address, chainId }); }
        catch (e) {
          log.warn('rewards', `${pid} fetchClaimables threw`, { msg: e?.message });
          return {};
        }
      })),
      // On targeted refresh we re-pull paired across ALL launches so the
      // aggregate stays consistent — claiming one token may zero a paired
      // balance that spans other launches.
      onlyToken ? runPaired(groupByPlugin(launches)) : runPaired(byPlugin),
    ]);
    setRewards((prev) => Object.assign({ ...prev }, ...perLaunch));
    setPairedRewards(paired);
  }, [address, launches, chainId, runPaired]);

  const tokensKey = (launches || []).map((l) => `${l.pluginId}:${l.token}`).sort().join(',');
  useEffect(() => {
    if (!address || !launches?.length) { setRewards({}); setPairedRewards([]); return; }
    let cancelled = false;
    (async () => {
      const byPlugin = groupByPlugin(launches);
      log.info('rewards', `batching ${launches.length} reads across ${byPlugin.size} plugin(s)`);
      const [perLaunch, paired] = await Promise.all([
        Promise.all([...byPlugin.entries()].map(async ([pid, list]) => {
          const p = pluginById(pid);
          if (!p) return {};
          try { return await p.fetchClaimables(list, { feeOwner: address, chainId }); }
          catch (e) {
            log.warn('rewards', `${pid} fetch threw`, { msg: e?.message });
            return {};
          }
        })),
        runPaired(byPlugin),
      ]);
      if (cancelled) return;
      setRewards(Object.assign({}, ...perLaunch));
      setPairedRewards(paired);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokensKey, chainId]);

  return { rewards, pairedRewards, refresh };
}

function groupByPlugin(launches) {
  const m = new Map();
  for (const l of launches) {
    const arr = m.get(l.pluginId) || [];
    arr.push(l);
    m.set(l.pluginId, arr);
  }
  return m;
}
