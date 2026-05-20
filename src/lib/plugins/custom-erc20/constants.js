// custom-erc20 plugin constants. This plugin discovers ERC-20 tokens that
// the user deployed OUTSIDE any known launcher — OpenZeppelin Wizard,
// Remix, hand-rolled custom contracts, etc.
//
// There is no factory address to anchor on (by definition — the user
// bypassed every known factory). Instead we anchor on a chain-wide log
// scan from a configurable floor block. Default floor is conservative
// (covers the bulk of Base mainnet activity) but the env override is
// there for users who know exactly when they deployed.

export const CUSTOM_ERC20 = {
  8453: {
    // Conservative floor — covers ~2024-onward when most one-off ERC-20
    // deploys happened on Base. Older deploys (pre-block-15M) won't be
    // found unless VITE_SCAN_FROM_BLOCK is set lower. Tradeoff: scanning
    // from genesis would be ~31M blocks × O(seconds-per-chunk) = hours.
    scanFloorBlock: 15_000_000n,
  },
};

/** External link patterns. We have no protocol UI to deep-link into for
 *  arbitrary contracts, so the "protocol" link is just the Basescan
 *  contract page — that's where the user goes to read/interact. */
export const CUSTOM_TOKEN_LINK = (token) =>
  `https://basescan.org/token/${token}`;

/** Heuristic threshold (basis points of totalSupply). A Transfer(0x0 → user)
 *  event is treated as a "deploy mint" only if the user received at least
 *  this fraction of the token's current totalSupply.
 *
 *  Why 5000 bps (50%)?
 *    - OpenZeppelin Wizard's default "Mintable" / "Premint" template mints
 *      the full initial supply to msg.sender, so the deployer receives
 *      100% of supply at deploy time — easily clears 50%.
 *    - Remix one-off ERC-20 tutorials almost always do `_mint(msg.sender, X)`
 *      in the constructor — same story, 100% to deployer.
 *    - Random airdrops typically distribute small per-wallet amounts (a few
 *      basis points each), so they're filtered out.
 *    - 50% leaves headroom for "deployer minted half, locked half in a
 *      vesting contract" patterns and still excludes airdrops.
 *
 *  Known false negatives we accept:
 *    - Deploys where the constructor mints to a multisig/treasury, then
 *      transfers to the user later. We'd never see a (0x0 → user) edge.
 *    - Tokens where supply has since grown such that the user's mint is
 *      now <50% (e.g. heavy inflation post-deploy). Acceptable — these
 *      look more like "early holder" than "deployer".
 *
 *  Known false positives we accept:
 *    - A bespoke airdrop contract that mints 50%+ of supply to one wallet.
 *      Rare, and the user can spot it from the symbol/name in the UI.
 */
export const DEPLOY_MINT_THRESHOLD_BPS = 5000n;
