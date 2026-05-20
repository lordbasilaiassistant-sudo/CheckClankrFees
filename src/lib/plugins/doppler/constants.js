// Doppler on Base mainnet. Sourced from https://docs.doppler.lol/reference/contract-addresses
// on 2026-05-20. Pinned per chain-id so adding more chains is one entry.

export const DOPPLER = {
  8453: {
    // v3 central orchestrator — emits Create(asset, indexed numeraire, initializer, poolOrHook)
    // and Collect(indexed to, indexed token, amount) when fees are collected.
    airlock: '0x660eAaEdEBc968f8f3694354FA8EC0b4c5Ba8D12',
    // Fee lockers. Both have the same beneficiariesClaims(beneficiary, currency) view.
    streamableFeesLocker:   '0x0a00775d71a42cd33d62780003035e7f5b47bd3a',
    streamableFeesLockerV2: '0xce3212e6536f33cd6fbfee265224131353ca3d47',
    // Airlock deployed around block 24M on Base — refine as we discover via
    // binary search. Until then, use a conservative floor that's still
    // ~6 months ago, not "since genesis".
    airlockDeployBlock: 24_000_000n,
  },
};

/** External link patterns. */
export const DOPPLER_TOKEN_LINK = (token) => `https://doppler.lol/token/8453/${token}`;
