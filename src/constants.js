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

/** Where users land for source code, issues, discussions. */
export const GITHUB_REPO_URL = 'https://github.com/lordbasilaiassistant-sudo/CheckClankrFees';

/** Live deployed app URL — used in OG/canonical and the live banner. */
export const LIVE_SITE_URL = 'https://lordbasilaiassistant-sudo.github.io/CheckClankrFees/';

/** Donation target — the maintainer's public Base address. ETH only.
 *  This is intentionally a fixed public address; users see it before they
 *  send. The donate flow uses native ETH so no token approvals are needed. */
export const DONATE_ADDRESS = '0x7a3E312Ec6e20a9F62fE2405938EB9060312E334';

/** Suggested donation presets in ETH (rendered as buttons). */
export const DONATE_PRESETS_ETH = ['0.001', '0.005', '0.01', '0.05'];
