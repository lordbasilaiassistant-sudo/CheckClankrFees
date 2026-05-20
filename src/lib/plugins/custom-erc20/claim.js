// custom-erc20 claim: not applicable. We don't know the contract's claim
// semantics (it could be anything — a Wizard template with no claim, a
// hand-rolled streamer, a fee splitter, a soulbound NFT-style token, …).
//
// The UI uses `supportsClaim = false` to suppress the claim button and
// fall back to the Basescan link as the protocol entry point.

export function buildClaimTx({ launch, feeOwner }) {
  void launch; void feeOwner;
  throw new Error(
    'custom-erc20 plugin does not support claim — open the contract on ' +
    'Basescan to interact with whatever claim function (if any) it exposes.'
  );
}

/** Plugins may export `supportsClaim` as a quick gate so the UI knows
 *  whether to render the "claim" button at all. We're discovery-only. */
export const supportsClaim = false;
