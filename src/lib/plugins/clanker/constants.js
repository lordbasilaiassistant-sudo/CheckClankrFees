// Clanker v4 on Base mainnet. Pinned per chain-id keys so adding Sepolia /
// Arbitrum / Unichain is just another entry.

export const CLANKER_V4 = {
  8453: {
    factory:            '0xE85A59c628F7d27878ACeB4bf3b35733630083a9',
    feeLocker:          '0xF3622742b1E446D92e45E22923Ef11C2fcD55D68',
    factoryDeployBlock: 31_526_699n,
  },
};

/** External link patterns. Tokens render with a "clanker" pill linking here. */
export const CLANKER_LINK = (token) => `https://clanker.world/clanker/${token}`;
