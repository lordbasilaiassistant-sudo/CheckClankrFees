// Read claimable fees from the Clanker v4 FeeLocker for one or more
// (feeOwner, token) pairs.
//
//   FeeLocker on Base: 0xF3622742…0d68 (see constants.js)
//   ABI: availableFees(address feeOwner, address token) view returns (uint256)
//
// All N tokens get batched into ONE Multicall3 call. 12 round-trips → 1.
// Reverts no longer poison the RPC pool (the aggregator classifies reverts
// as RPC success — see lib/rpc/classify.js).

import { parseAbi, getAddress } from 'viem';
import { log } from '../debug.js';
import { rpc, readContract } from '../rpc/index.js';
import { FEE_LOCKER_BASE } from '../../constants.js';

export const FEE_LOCKER_ABI = parseAbi([
  'function availableFees(address feeOwner, address token) view returns (uint256)',
]);

/**
 * Batch-read claimable fees for many tokens at once via Multicall3.
 *
 * @param {object} args
 * @param {string} args.feeOwner — recipient address (= connected wallet)
 * @param {string[]} args.tokens — token contract addresses
 * @param {string} [args.locker=FEE_LOCKER_BASE]
 * @returns {Promise<Record<string, { amount: bigint, error?: string }>>}
 */
export async function availableFeesBatch({ feeOwner, tokens, locker = FEE_LOCKER_BASE }) {
  if (!tokens?.length) return {};
  const owner = getAddress(feeOwner);
  const calls = tokens.map((t) => ({
    address: locker,
    abi: FEE_LOCKER_ABI,
    functionName: 'availableFees',
    args: [owner, getAddress(t)],
  }));

  const endDone = log.time('rewards', `multicall availableFees × ${tokens.length}`);
  let results;
  try {
    results = await rpc.withClient('multicall.availableFees', (c) =>
      c.multicall({ contracts: calls, allowFailure: true, batchSize: 50 })
    );
  } catch (e) {
    log.error('rewards', 'multicall failed entirely — falling back to per-token reads', { msg: e?.shortMessage || e?.message });
    return availableFeesFallback({ feeOwner: owner, tokens, locker });
  }

  const out = {};
  let okCount = 0, revertCount = 0;
  for (let i = 0; i < tokens.length; i++) {
    const r = results[i];
    const addr = getAddress(tokens[i]);
    if (r?.status === 'success') {
      out[addr] = { amount: r.result };
      okCount++;
    } else {
      out[addr] = { amount: 0n, error: r?.error?.shortMessage || 'reverted' };
      revertCount++;
    }
  }
  endDone({ ok: okCount, reverted: revertCount });
  return out;
}

async function availableFeesFallback({ feeOwner, tokens, locker }) {
  const out = {};
  for (const t of tokens) {
    const addr = getAddress(t);
    try {
      const amount = await readContract({
        address: locker,
        abi: FEE_LOCKER_ABI,
        functionName: 'availableFees',
        args: [feeOwner, addr],
      });
      out[addr] = { amount };
    } catch (e) {
      out[addr] = { amount: 0n, error: e?.shortMessage || 'reverted' };
    }
  }
  return out;
}
