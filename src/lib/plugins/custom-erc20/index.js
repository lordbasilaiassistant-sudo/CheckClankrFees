// custom-erc20 plugin. See ../types.js for the contract every plugin honors.
//
// Coverage in this version:
//   - Discovery: Transfer(from=0x0, to=user) events across the whole chain,
//                gated by a ≥50%-of-totalSupply heuristic so airdrops drop
//                out and one-shot deploys (OZ Wizard, Remix, hand-rolled)
//                survive. See discovery.js for the rationale.
//   - Claimables: stubbed — every entry is zero. Arbitrary contracts have
//                arbitrary fee semantics, so we don't guess.
//   - Claim: NOT supported — UI hides the claim button and falls back to
//                the Basescan link.

import { scanLaunches } from './discovery.js';
import { fetchClaimables } from './rewards.js';
import { buildClaimTx, supportsClaim } from './claim.js';

export default {
  id: 'custom-erc20',
  name: 'Custom ERC-20',
  chains: [8453],
  scanLaunches,
  fetchClaimables,
  buildClaimTx,
  supportsClaim,
};
