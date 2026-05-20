// Doppler claimable lookup. Two lockers exist (v1 + v2) — both share the
// same `beneficiariesClaims(beneficiary, currency)` view. We sum across
// both so the user sees a single combined claimable per token.

import { parseAbi, getAddress } from 'viem';
import { log } from '../../debug.js';
import { rpc } from '../../rpc/index.js';
import { DOPPLER } from './constants.js';

export const LOCKER_ABI = parseAbi([
  'function beneficiariesClaims(address beneficiary, address currency) view returns (uint256)',
]);

export async function fetchClaimables(launches, { feeOwner, chainId = 8453 }) {
  const cfg = DOPPLER[chainId];
  if (!cfg || !launches.length) return {};
  const owner = getAddress(feeOwner);
  const lockers = [cfg.streamableFeesLocker, cfg.streamableFeesLockerV2].filter(Boolean);

  // Build {locker × token} calls.
  const calls = [];
  for (const locker of lockers) {
    for (const l of launches) {
      calls.push({
        address: locker,
        abi: LOCKER_ABI,
        functionName: 'beneficiariesClaims',
        args: [owner, getAddress(l.token)],
      });
    }
  }

  const endDone = log.time('doppler.rewards', `multicall × ${calls.length} (${launches.length} tokens × ${lockers.length} lockers)`);
  let results;
  try {
    results = await rpc.withClient('doppler.multicall.beneficiariesClaims', (c) =>
      c.multicall({ contracts: calls, allowFailure: true, batchSize: 100 })
    );
  } catch (e) {
    log.error('doppler.rewards', 'multicall failed entirely — returning zeros', { msg: e?.shortMessage });
    return Object.fromEntries(launches.map((l) => [getAddress(l.token), { amount: 0n, currency: 'TOKEN', error: 'multicall failed' }]));
  }

  // Sum across lockers per token.
  const out = {};
  let ok = 0, reverted = 0;
  for (let li = 0; li < lockers.length; li++) {
    for (let ti = 0; ti < launches.length; ti++) {
      const idx = li * launches.length + ti;
      const r = results[idx];
      const tok = getAddress(launches[ti].token);
      if (!out[tok]) out[tok] = { amount: 0n, currency: 'TOKEN' };
      if (r?.status === 'success') {
        out[tok].amount += BigInt(r.result || 0);
        ok++;
      } else {
        reverted++;
      }
    }
  }
  endDone({ ok, reverted });
  return out;
}
