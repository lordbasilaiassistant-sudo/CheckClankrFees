import { parseAbiItem } from 'viem';

// Standard ERC-20 Transfer event. `from` and `to` are both indexed →
// server-side filter on `from = 0x0` AND `to = userAddr` collapses the
// entire chain's Transfer firehose down to "tokens that minted to this
// user". Topic0 hash: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef.
//
// Note: we deliberately do NOT pass an `address` to getLogs — we want
// matches across ALL contracts on the chain, not from a single factory.
// That's the entire point of this plugin (find tokens deployed outside
// known launchers, where by definition no factory address is known).
export const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

/** The canonical "zero address" — both `from` and `to` use it to signal
 *  mint and burn respectively. Mint = Transfer(0x0, recipient, value). */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
