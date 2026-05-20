// Single source of truth for the chain-level constants this app talks to.
// All addresses checksummed.

/** Clanker v4 factory on Base mainnet. */
export const CLANKER_V4_FACTORY = '0xE85A59c628F7d27878ACeB4bf3b35733630083a9';

/** Clanker v4 FeeLocker (singleton) on Base mainnet — where claimable fees sit. */
export const FEE_LOCKER_BASE = '0xF3622742b1E446D92e45E22923Ef11C2fcD55D68';

/** Block at which the Clanker v4 factory was first deployed on Base mainnet.
 *  Verified on-chain 2026-05-20 by binary search on `getBytecode`.
 *  Scanning earlier than this is wasted RPC calls. */
export const FACTORY_DEPLOY_BLOCK = 31_526_699n;

/** Default per-chunk block range for getLogs. Public Base RPCs cap at ~10k. */
export const DEFAULT_SCAN_CHUNK = 9_999n;

/** Default parallel chunks during scan. Above 5 starts hitting rate limits. */
export const DEFAULT_SCAN_CONCURRENCY = 5;

/** Default getLogs quorum factor. 1 = single-source (fast, vulnerable to a
 *  lying RPC); 2 = two-of-N agreement (safer, slower). */
export const DEFAULT_LOGS_QUORUM = 2;

/** Base chain id, hardcoded — this app is Base-only by design. */
export const BASE_CHAIN_ID = 8453;
