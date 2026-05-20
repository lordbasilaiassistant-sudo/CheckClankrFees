// Validators / sanitizers for data coming out of on-chain events.
//
// Even though viem decodes the ABI, the source-of-truth strings (tokenName,
// tokenSymbol, tokenImage) are arbitrary deployer-controlled. A bad actor
// can embed RTL bidi overrides, zero-width chars, control codes, or 10 MB
// of junk. We never blindly forward.

import { getAddress } from 'viem';

/** Pattern for a 32-byte tx hash (or pool id). */
export const HASH_RE_64 = /^0x[0-9a-fA-F]{64}$/;

/** Returns checksummed address or null if invalid. */
export function safeAddress(maybe) {
  if (typeof maybe !== 'string') return null;
  try { return getAddress(maybe); } catch { return null; }
}

/** Strip control + bidi + zero-width chars; truncate. Used on every text
 *  field rendered in the table.
 *
 *  Phishing context: a malicious tokenAdmin can name their token "‮nimdAekot"
 *  (an RTL override + text) so the row visually flips, mimicking a token
 *  the user actually owns. Combined with a forged claimable balance, this
 *  is a one-click phishing pipeline via the clanker.world link. Strip the
 *  control codes and the spoof becomes obvious. */
export function sanitizeText(s, maxLen = 64) {
  if (typeof s !== 'string') return '';
  // C0 + DEL/C1 + zero-width + bidi overrides + bidi isolates
  // eslint-disable-next-line no-control-regex
  const stripped = s.replace(/[\x00-\x1F\x7F-\x9F​-‏‪-‮⁦-⁩]/g, '');
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
}
