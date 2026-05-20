// Plugin-aware claimable lookup. Groups launches by pluginId, calls each
// plugin's `fetchClaimables` (which uses its own multicall shape), then
// merges into a flat { [token]: Claimable } map.

import { useCallback, useEffect, useState } from 'react';
import { pluginById, PLUGINS } from '../lib/plugins/index.js';
import { log } from '../lib/debug.js';

export function useFeeRewards(address, launches, { chainId = 8453 } = {}) {
  const [rewards, setRewards] = useState({});

  const refresh = useCallback(async (onlyToken) => {
    if (!address || !launches?.length) return;
    const targets = onlyToken
      ? launches.filter((l) => l.token === onlyToken)
      : launches;
    // Group by plugin so each call uses the right ABI/locker.
    const byPlugin = new Map();
    for (const l of targets) {
      const arr = byPlugin.get(l.pluginId) || [];
      arr.push(l);
      byPlugin.set(l.pluginId, arr);
    }
    log.info('rewards', `refreshing ${targets.length} launches across ${byPlugin.size} plugin(s)`);
    const results = await Promise.all([...byPlugin.entries()].map(async ([pid, list]) => {
      const p = pluginById(pid);
      if (!p) return {};
      try { return await p.fetchClaimables(list, { feeOwner: address, chainId }); }
      catch (e) {
        log.warn('rewards', `${pid} fetchClaimables threw`, { msg: e?.message });
        return {};
      }
    }));
    setRewards((prev) => Object.assign({ ...prev }, ...results));
  }, [address, launches, chainId]);

  const tokensKey = (launches || []).map((l) => `${l.pluginId}:${l.token}`).sort().join(',');
  useEffect(() => {
    if (!address || !launches?.length) { setRewards({}); return; }
    let cancelled = false;
    (async () => {
      const byPlugin = new Map();
      for (const l of launches) {
        const arr = byPlugin.get(l.pluginId) || [];
        arr.push(l);
        byPlugin.set(l.pluginId, arr);
      }
      log.info('rewards', `batching ${launches.length} reads across ${byPlugin.size} plugin(s)`);
      const results = await Promise.all([...byPlugin.entries()].map(async ([pid, list]) => {
        const p = pluginById(pid);
        if (!p) return {};
        try { return await p.fetchClaimables(list, { feeOwner: address, chainId }); }
        catch (e) {
          log.warn('rewards', `${pid} fetch threw`, { msg: e?.message });
          return {};
        }
      }));
      if (cancelled) return;
      setRewards(Object.assign({}, ...results));
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokensKey, chainId]);

  return { rewards, refresh };
}
