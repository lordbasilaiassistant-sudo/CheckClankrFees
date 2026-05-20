// Doppler protocol plugin. See ../types.js for the contract.
//
// Coverage in this version:
//   - Discovery: Collect events to the user (tokens that have paid them).
//                Catches anything where the user is a beneficiary.
//                NOT yet: tokens the user deployed but never collected from
//                (deployer is not indexed on Doppler's Create event).
//   - Claimables: beneficiariesClaims summed across the v1 and v2 lockers.
//   - Claim: NOT yet wired — UI falls back to the doppler.lol link.

import { scanLaunches } from './discovery.js';
import { fetchClaimables } from './rewards.js';
import { buildClaimTx, supportsClaim } from './claim.js';

export default {
  id: 'doppler',
  name: 'Doppler',
  chains: [8453],
  scanLaunches,
  fetchClaimables,
  buildClaimTx,
  supportsClaim,
};
