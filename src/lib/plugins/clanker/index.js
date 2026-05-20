// Clanker v4 plugin. See ../types.js for the interface every plugin honors.
import { scanLaunches } from './discovery.js';
import { fetchClaimables } from './rewards.js';
import { buildClaimTx } from './claim.js';

export default {
  id: 'clanker',
  name: 'Clanker',
  chains: [8453],
  scanLaunches,
  fetchClaimables,
  buildClaimTx,
};
