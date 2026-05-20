import { parseAbiItem } from 'viem';

// Airlock events. The signatures here match the on-chain ABI exactly so
// viem's topic0 hash lines up.

/** Fee paid out to a beneficiary. `to` and `token` are both indexed — we
 *  can filter server-side by `to == userAddress` cheaply. This is our
 *  primary discovery signal for Doppler: any token that has paid the user
 *  even once is a candidate for currently-claimable fees. */
export const COLLECT_EVENT = parseAbiItem(
  'event Collect(address indexed to, address indexed token, uint256 amount)'
);

/** A new asset was deployed via Airlock.
 *  NOTE: the creator (msg.sender of create()) is NOT indexed in this event,
 *  so we can't cheaply filter "tokens I deployed" via topic. To discover by
 *  deployer we'd need to walk every Create event and check tx.from per
 *  log — deferred to v2 of this plugin. */
export const CREATE_EVENT = parseAbiItem(
  'event Create(address asset, address indexed numeraire, address initializer, address poolOrHook)'
);

/** Liquidity migration (token went from auction → AMM pool). Indexed
 *  asset + pool — not user-keyed. Informational only for now. */
export const MIGRATE_EVENT = parseAbiItem(
  'event Migrate(address indexed asset, address indexed pool)'
);
