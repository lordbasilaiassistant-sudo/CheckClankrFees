// React hook wrapping availableFeesBatch. Fires one multicall whenever the
// token list or address changes. Returns:
//   - rewards: { [tokenAddress]: { amount: bigint, error?: string } }
//   - refresh(token?): re-read one token's fee (no token = all). Used after
//     a successful claim to update the row in place.

import { useCallback, useEffect, useState } from 'react';
import { availableFeesBatch } from '../lib/clanker/rewards.js';
import { log } from '../lib/debug.js';

export function useFeeRewards(address, tokenAddresses) {
  const [rewards, setRewards] = useState({});

  const refresh = useCallback(async (onlyToken) => {
    if (!address || !tokenAddresses?.length) return;
    const targets = onlyToken ? [onlyToken] : tokenAddresses;
    log.info('rewards', `refreshing ${targets.length} token(s)`, { onlyToken });
    try {
      const map = await availableFeesBatch({ feeOwner: address, tokens: targets });
      setRewards((prev) => ({ ...prev, ...map }));
    } catch (e) {
      log.warn('rewards', 'refresh failed', { msg: e?.message });
    }
  }, [address, tokenAddresses]);

  // Refire when the address or the *set* of tokens changes. We compare
  // addresses as a sorted-join so identical-but-different-array-reference
  // doesn't re-trigger.
  const tokensKey = (tokenAddresses || []).slice().sort().join(',');
  useEffect(() => {
    if (!address || !tokenAddresses?.length) { setRewards({}); return; }
    let cancelled = false;
    log.info('rewards', `batching fee reads for ${tokenAddresses.length} tokens via multicall`);
    availableFeesBatch({ feeOwner: address, tokens: tokenAddresses })
      .then((map) => { if (!cancelled) setRewards(map); })
      .catch((e) => log.warn('rewards', 'batch fetch failed', { msg: e?.message }));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokensKey]);

  return { rewards, refresh };
}
