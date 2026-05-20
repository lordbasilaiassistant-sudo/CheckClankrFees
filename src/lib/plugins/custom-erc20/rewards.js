// custom-erc20 rewards: discovery-only plugin. We surface tokens the user
// deployed via arbitrary (non-launcher) contracts, but we don't pretend
// to know their fee semantics — there isn't one. A bespoke ERC-20 has
// whatever claim/payout function its author wrote, if any.
//
// So fetchClaimables returns a zero entry per token (currency = TOKEN as a
// neutral placeholder). The UI shows the launch row with a Basescan link,
// no claim button (see claim.js — supportsClaim = false).

import { getAddress } from 'viem';

export async function fetchClaimables(launches /*, { feeOwner, chainId } */) {
  if (!launches?.length) return {};
  const out = {};
  for (const l of launches) {
    const tok = getAddress(l.token);
    out[tok] = { amount: 0n, currency: 'TOKEN' };
  }
  return out;
}
