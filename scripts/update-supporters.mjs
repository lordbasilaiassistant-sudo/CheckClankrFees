#!/usr/bin/env node
// Walk Base mainnet for ETH transfers (and internal transfers) into the
// donate address and rebuild SUPPORTERS.md + the README marker block.
//
// Runs in CI (.github/workflows/supporters.yml) so we don't keep a server
// running. Pure Node — uses viem + the project's RPC aggregator endpoints
// list. No private keys, no writes, no DB.
//
// Output:
//   SUPPORTERS.md        — full ranked table
//   README.md            — top-10 block replaced between markers
//
// Detection strategy:
//   1. eth_getBalance — sanity check the address exists.
//   2. Walk transactions where `to == DONATE_ADDRESS` via batched eth_getLogs
//      on a synthetic event? Actually `getLogs` only sees ERC-20 transfers
//      and emitted events — plain ETH sends are not logged. So we need
//      eth_getTransactionsByAddress (no such standard RPC) OR walk every
//      block and check tx.to. Walking blocks is wildly expensive.
//
//   Pragmatic answer: use Basescan's free API (no key required for the
//   public endpoint, with a low rate limit). That's the standard
//   "transactions by address" data source on EVM chains. Fall back to
//   "no supporters yet" if the API is unreachable.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Mirrors src/constants.js — keep in sync if you change the donate address.
const DONATE_ADDRESS = '0x7a3E312Ec6e20a9F62fE2405938EB9060312E334';
const BASE_CHAIN_ID = 8453;

const README_PATH = join(repoRoot, 'README.md');
const SUPPORTERS_PATH = join(repoRoot, 'SUPPORTERS.md');
const README_MARK_START = '<!-- SUPPORTERS:START -->';
const README_MARK_END = '<!-- SUPPORTERS:END -->';

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || '';

async function fetchTransactions() {
  // External + internal transactions. ETH-only (no token logic).
  const out = [];
  for (const action of ['txlist', 'txlistinternal']) {
    const url = `${ETHERSCAN_V2}?chainid=${BASE_CHAIN_ID}&module=account&action=${action}&address=${DONATE_ADDRESS}&startblock=0&endblock=99999999&sort=asc${ETHERSCAN_KEY ? `&apikey=${ETHERSCAN_KEY}` : ''}`;
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`HTTP ${r.status} from ${action}`);
      continue;
    }
    const j = await r.json();
    if (j.status !== '1' && j.message !== 'No transactions found') {
      console.error(`${action}: ${j.message} (result: ${typeof j.result === 'string' ? j.result : 'array'})`);
      // If the free key doesn't cover Base, we get NOTOK — just continue.
      continue;
    }
    if (Array.isArray(j.result)) out.push(...j.result);
  }
  return out;
}

function aggregate(txs) {
  const supporters = new Map(); // from -> { totalWei, txCount, firstTs, lastTs }
  const target = DONATE_ADDRESS.toLowerCase();
  for (const t of txs) {
    if (!t || (t.to || '').toLowerCase() !== target) continue;
    if (t.isError === '1') continue;
    const valueWei = BigInt(t.value || '0');
    if (valueWei <= 0n) continue;
    const from = (t.from || '').toLowerCase();
    if (!from) continue;
    if (from === target) continue; // self-transfer
    const ts = Number(t.timeStamp || 0) * 1000;
    const existing = supporters.get(from) || { totalWei: 0n, txCount: 0, firstTs: ts, lastTs: ts };
    existing.totalWei += valueWei;
    existing.txCount += 1;
    existing.firstTs = Math.min(existing.firstTs || ts, ts);
    existing.lastTs = Math.max(existing.lastTs || ts, ts);
    supporters.set(from, existing);
  }
  return [...supporters.entries()]
    .map(([addr, v]) => ({ addr, ...v }))
    .sort((a, b) => (b.totalWei > a.totalWei ? 1 : b.totalWei < a.totalWei ? -1 : 0));
}

function fmtEth(wei) {
  const s = (Number(wei) / 1e18).toFixed(6);
  return s.replace(/\.?0+$/, '') || '0';
}

function shortAddr(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

function generateSupportersMd(rows) {
  const total = rows.reduce((acc, r) => acc + r.totalWei, 0n);
  const lines = [
    '# Supporters',
    '',
    'Everyone who has sent Base ETH to support the project, ranked by total.',
    'Updated daily by `.github/workflows/supporters.yml`.',
    '',
    `**Total received:** ${fmtEth(total)} ETH across ${rows.length} supporters.`,
    '',
    '| # | Address | Total (ETH) | Donations | First | Last |',
    '| --- | --- | ---: | ---: | --- | --- |',
  ];
  rows.forEach((r, i) => {
    const link = `[${shortAddr(r.addr)}](https://basescan.org/address/${r.addr})`;
    lines.push(`| ${i + 1} | ${link} | ${fmtEth(r.totalWei)} | ${r.txCount} | ${fmtDate(r.firstTs)} | ${fmtDate(r.lastTs)} |`);
  });
  if (rows.length === 0) {
    lines.push('| — | _no supporters yet — be the first_ | — | — | — | — |');
  }
  lines.push('', '<!-- generated by scripts/update-supporters.mjs — do not edit by hand -->', '');
  return lines.join('\n');
}

function generateReadmeBlock(rows) {
  const top = rows.slice(0, 10);
  const lines = [
    README_MARK_START,
    '',
    '## Supporters',
    '',
    'Auto-tracked from on-chain donations to the maintainer\'s Base address. Full list in [`SUPPORTERS.md`](SUPPORTERS.md).',
    '',
  ];
  if (top.length === 0) {
    lines.push('_No supporters yet — be the first via the "Support dev" panel on the live site._', '');
  } else {
    lines.push('| # | Address | Total (ETH) | Donations |', '| --- | --- | ---: | ---: |');
    top.forEach((r, i) => {
      lines.push(`| ${i + 1} | [\`${shortAddr(r.addr)}\`](https://basescan.org/address/${r.addr}) | ${fmtEth(r.totalWei)} | ${r.txCount} |`);
    });
    lines.push('');
  }
  lines.push(README_MARK_END);
  return lines.join('\n');
}

function injectIntoReadme(readme, block) {
  const has = readme.includes(README_MARK_START) && readme.includes(README_MARK_END);
  if (has) {
    const re = new RegExp(`${README_MARK_START}[\\s\\S]*?${README_MARK_END}`);
    return readme.replace(re, block);
  }
  // First run — append above the License section if it exists, else at the end.
  const licenseIdx = readme.indexOf('## License');
  if (licenseIdx >= 0) return readme.slice(0, licenseIdx) + block + '\n\n' + readme.slice(licenseIdx);
  return readme.trimEnd() + '\n\n' + block + '\n';
}

(async () => {
  console.log(`Fetching donations to ${DONATE_ADDRESS} on Base mainnet…`);
  const txs = await fetchTransactions();
  console.log(`Got ${txs.length} candidate tx rows (external + internal).`);
  const rows = aggregate(txs);
  console.log(`Aggregated ${rows.length} unique supporters.`);

  const supportersMd = generateSupportersMd(rows);
  writeFileSync(SUPPORTERS_PATH, supportersMd);
  console.log(`Wrote ${SUPPORTERS_PATH}`);

  if (existsSync(README_PATH)) {
    const readme = readFileSync(README_PATH, 'utf8');
    const block = generateReadmeBlock(rows);
    const updated = injectIntoReadme(readme, block);
    if (updated !== readme) {
      writeFileSync(README_PATH, updated);
      console.log('Updated README.md supporters block.');
    } else {
      console.log('README.md unchanged.');
    }
  }
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
