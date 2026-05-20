// Clanker v4 factory event signature + parser. Single source of truth — if
// the factory ABI ever changes, only this file needs to update.
//
// The event is emitted by the factory at 0xE85A59c6…0083a9 on Base mainnet.
// Indexed positions match the verified ABI:
//   - msgSender (unindexed)
//   - tokenAddress (indexed)
//   - tokenAdmin (indexed)
//
// extensions[] is included so the parsed signature matches the on-chain
// topic0 exactly — viem won't decode a partial signature.

import { parseAbiItem } from 'viem';
import { log } from '../debug.js';
import { safeAddress, sanitizeText, HASH_RE_64 } from './sanitize.js';

export const TOKEN_CREATED_EVENT = parseAbiItem(
  'event TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address mevModule, uint256 extensionsSupply, address[] extensions)'
);

/** Parse a raw viem log entry into a UI-safe token record. Returns null if
 *  any critical field is malformed (we discard the event entirely rather
 *  than render a half-broken row). */
export function parseTokenCreated(ev) {
  const a = ev.args || {};
  const token = safeAddress(a.tokenAddress);
  const admin = safeAddress(a.tokenAdmin);
  const txHash = HASH_RE_64.test(ev.transactionHash || '') ? ev.transactionHash : null;
  if (!token || !admin || !txHash) {
    log.warn('scan', 'discarding malformed TokenCreated event', {
      tokenAddress: a.tokenAddress, tokenAdmin: a.tokenAdmin, txHash: ev.transactionHash,
    });
    return null;
  }
  return {
    token,
    admin,
    deployer: safeAddress(a.msgSender),
    name: sanitizeText(a.tokenName),
    symbol: sanitizeText(a.tokenSymbol, 16),
    image: typeof a.tokenImage === 'string' ? a.tokenImage : '', // scheme-checked at render time
    metadata: typeof a.tokenMetadata === 'string' ? a.tokenMetadata.slice(0, 2048) : '',
    locker: safeAddress(a.locker),
    poolHook: safeAddress(a.poolHook),
    poolId: HASH_RE_64.test(a.poolId || '') ? a.poolId : null,
    pairedToken: safeAddress(a.pairedToken),
    blockNumber: ev.blockNumber,
    txHash,
  };
}
