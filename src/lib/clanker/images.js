// Token image URL guard. tokenImage from TokenCreated is arbitrary
// deployer-controlled. Three risks we neutralize before handing the URL to
// <img src>:
//
//   1. javascript: / data: / blob: URLs (browser quirk surface)
//   2. tracking-pixel http(s) URLs that learn "wallet X visited at Y"
//   3. arbitrary cache poison via Content-Disposition / oversized payloads
//
// Strategy: only allow https://, rewrite ipfs:// to a public gateway, drop
// everything else. The <img> tag should also set referrerPolicy=no-referrer
// and crossOrigin=anonymous so the image host sees an anonymized request.

const MAX_URL_LEN = 2048;

export function safeImageUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LEN) return null;
  if (trimmed.toLowerCase().startsWith('ipfs://')) {
    const cidAndPath = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return `https://ipfs.io/ipfs/${cidAndPath}`;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}
