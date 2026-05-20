// Clanker fee-locker reads. ABI:
//   availableFees(address feeOwner, address token) view returns (uint256)
//
// Batch all N tokens into one Multicall3 round-trip.

import { parseAbi, getAddress } from 'viem';
import { log } from '../../debug.js';
import { rpc, readContract } from '../../rpc/index.js';
import { CLANKER_V4 } from './constants.js';

export const FEE_LOCKER_ABI = parseAbi([
  'function availableFees(address feeOwner, address token) view returns (uint256)',
]);

export async function fetchClaimables(launches, { feeOwner, chainId = 8453 }) {
  const cfg = CLANKER_V4[chainId];
  if (!cfg || !launches.length) return {};
  const owner = getAddress(feeOwner);
  const calls = launches.map((l) => ({
    address: cfg.feeLocker,
    abi: FEE_LOCKER_ABI,
    functionName: 'availableFees',
    args: [owner, getAddress(l.token)],
  }));
  const endDone = log.time('clanker.rewards', `multicall × ${launches.length}`);
  let results;
  try {
    results = await rpc.withClient('clanker.multicall.availableFees', (c) =>
      c.multicall({ contracts: calls, allowFailure: true, batchSize: 50 })
    );
  } catch (e) {
    log.error('clanker.rewards', 'multicall failed entirely — per-token fallback', { msg: e?.shortMessage });
    return fallback(launches, owner, cfg.feeLocker);
  }
  const out = {};
  let ok = 0, reverted = 0;
  for (let i = 0; i < launches.length; i++) {
    const r = results[i];
    const tok = getAddress(launches[i].token);
    if (r?.status === 'success') {
      out[tok] = { amount: r.result, currency: 'PAIRED' }; // paired ERC20 (often WETH-class)
      ok++;
    } else {
      out[tok] = { amount: 0n, currency: 'PAIRED', error: r?.error?.shortMessage || 'reverted' };
      reverted++;
    }
  }
  endDone({ ok, reverted });
  return out;
}

async function fallback(launches, owner, locker) {
  const out = {};
  for (const l of launches) {
    const tok = getAddress(l.token);
    try {
      const amount = await readContract({
        address: locker, abi: FEE_LOCKER_ABI, functionName: 'availableFees', args: [owner, tok],
      });
      out[tok] = { amount, currency: 'PAIRED' };
    } catch (e) {
      out[tok] = { amount: 0n, currency: 'PAIRED', error: e?.shortMessage || 'reverted' };
    }
  }
  return out;
}
