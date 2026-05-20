// Doppler claim. NOT YET WIRED — the StreamableFeesLocker exposes a
// `claim()` or `collect()` style function but the exact signature varies
// between v1 and v2 lockers. Until we plumb that in, the plugin reports
// claimables but the UI hides the claim button for Doppler rows.

export function buildClaimTx({ launch, feeOwner }) {
  void launch; void feeOwner;
  throw new Error('Doppler claim not yet implemented in this plugin version. ' +
    'Use doppler.lol to claim until the next release.');
}

/** Plugins may export `supportsClaim` as a quick gate so the UI knows
 *  whether to render the "claim" button at all. */
export const supportsClaim = false;
