#!/usr/bin/env node
// Walk Base mainnet for ETH transfers into the donate address and rebuild
// SUPPORTERS.md + the README marker block.
//
// Runs in CI (.github/workflows/supporters.yml). Pure Node — uses viem and
// the same free Base RPC pool the browser app uses. NO external explorer
// APIs (Etherscan etc.) — the free Etherscan v2 key doesn't cover Base, so
// every previous run reported "0 supporters". This walks blocks directly
// via eth_getBlockByNumber(N, true) across multiple RPCs in parallel.
//
// State is persisted to scripts/.supporters-state.json so the next run
// resumes from where the previous one stopped. The state file is the
// source of truth for donations; SUPPORTERS.md is regenerated each run.
//
// Output:
//   SUPPORTERS.md                — full ranked table
//   README.md                    — top-10 block replaced between markers
//   scripts/.supporters-state.json — { firstScanBlock, lastScannedBlock, donations[] }

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Mirrors src/constants.js — keep in sync if you change the donate address.
const DONATE_ADDRESS = '0x7a3E312Ec6e20a9F62fE2405938EB9060312E334';
const DONATE_LC = DONATE_ADDRESS.toLowerCase();

const README_PATH = join(repoRoot, 'README.md');
const SUPPORTERS_PATH = join(repoRoot, 'SUPPORTERS.md');
const STATE_PATH = join(__dirname, '.supporters-state.json');
const README_MARK_START = '<!-- SUPPORTERS:START -->';
const README_MARK_END = '<!-- SUPPORTERS:END -->';

// Mirrors src/lib/rpc/endpoints.js — duplicated because that file targets
// the Vite browser build (uses import.meta.env). Keep in sync.
const BASE_RPCS = [
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://base.drpc.org',
  'https://base-rpc.publicnode.com',
  'https://1rpc.io/base',
  'https://base.meowrpc.com',
  'https://endpoints.omniatech.io/v1/base/mainnet/public',
  'https://base.blockpi.network/v1/rpc/public',
  'https://base-mainnet.public.blastapi.io',
  'https://rpc.ankr.com/base',
  'https://base.gateway.tenderly.co',
];

// Tunables.
const REORG_BUFFER = 50;            // stay this many blocks behind head
const FIRST_RUN_LOOKBACK = 100;     // first run starts head - this
const MAX_BLOCKS_PER_RUN = 250_000; // hard cap to protect CI runtime
const CONCURRENCY = 10;             // parallel block fetches
const RPC_FAIL_THRESHOLD = 5;       // skip RPC after this many consecutive fails
const PER_CALL_TIMEOUT_MS = 12_000;
const PER_CALL_RETRIES = 2;

// ---------- RPC pool with simple health rotation ----------

function makePool(urls) {
  const clients = urls.map((url) => ({
    url,
    client: createPublicClient({
      chain: base,
      transport: http(url, { timeout: PER_CALL_TIMEOUT_MS, retryCount: 0 }),
    }),
    fails: 0,
    skipped: false,
  }));
  let cursor = 0;
  return {
    size: () => clients.filter((c) => !c.skipped).length,
    // round-robin over healthy endpoints
    next: () => {
      const healthy = clients.filter((c) => !c.skipped);
      if (healthy.length === 0) return null;
      const pick = healthy[cursor % healthy.length];
      cursor++;
      return pick;
    },
    markOk: (entry) => { entry.fails = 0; },
    markFail: (entry, err) => {
      entry.fails += 1;
      if (entry.fails >= RPC_FAIL_THRESHOLD && !entry.skipped) {
        entry.skipped = true;
        console.warn(`[rpc] dropping ${entry.url} after ${entry.fails} consecutive failures (${err?.shortMessage || err?.message || err})`);
      }
    },
    snapshot: () => clients.map((c) => ({ url: c.url, fails: c.fails, skipped: c.skipped })),
  };
}

async function withRetry(pool, op) {
  // Try up to (healthy pool size) endpoints, each up to PER_CALL_RETRIES + 1 times.
  let lastErr;
  const attempts = Math.max(pool.size(), 1) + PER_CALL_RETRIES;
  for (let i = 0; i < attempts; i++) {
    const entry = pool.next();
    if (!entry) throw new Error('all RPC endpoints exhausted');
    try {
      const res = await op(entry.client, entry.url);
      pool.markOk(entry);
      return res;
    } catch (err) {
      lastErr = err;
      pool.markFail(entry, err);
    }
  }
  throw lastErr || new Error('all retries failed');
}

// ---------- Block walking ----------

async function getHead(pool) {
  return Number(await withRetry(pool, (c) => c.getBlockNumber()));
}

async function getBlockWithTxs(pool, blockNumber) {
  return withRetry(pool, (c) => c.getBlock({ blockNumber: BigInt(blockNumber), includeTransactions: true }));
}

function extractDonations(block) {
  const out = [];
  const ts = Number(block.timestamp) * 1000;
  const blockNumber = Number(block.number);
  for (const tx of block.transactions) {
    if (!tx || !tx.to) continue;
    if (tx.to.toLowerCase() !== DONATE_LC) continue;
    const value = typeof tx.value === 'bigint' ? tx.value : BigInt(tx.value || 0);
    if (value <= 0n) continue;
    out.push({
      from: tx.from.toLowerCase(),
      value: '0x' + value.toString(16),
      blockNumber,
      hash: tx.hash,
      ts,
    });
  }
  return out;
}

async function walkBlocks(pool, startBlock, endBlock, onProgress) {
  const total = endBlock - startBlock + 1;
  if (total <= 0) return [];
  const found = [];
  let processed = 0;
  let nextBlock = startBlock;
  let lastReportPct = -1;

  async function worker() {
    while (true) {
      const blockNumber = nextBlock++;
      if (blockNumber > endBlock) return;
      try {
        const block = await getBlockWithTxs(pool, blockNumber);
        const hits = extractDonations(block);
        if (hits.length > 0) {
          for (const h of hits) {
            console.log(`[hit] block ${h.blockNumber} from ${h.from} value ${h.value} tx ${h.hash}`);
          }
          found.push(...hits);
        }
      } catch (err) {
        console.error(`[fatal-block] could not fetch block ${blockNumber}: ${err?.shortMessage || err?.message || err}`);
        throw err;
      }
      processed++;
      const pct = Math.floor((processed / total) * 100);
      if (pct !== lastReportPct && pct % 10 === 0) {
        lastReportPct = pct;
        onProgress?.(processed, total, pct);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker());
  await Promise.all(workers);
  return found;
}

// ---------- State ----------

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    const raw = readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      firstScanBlock: String(parsed.firstScanBlock ?? ''),
      lastScannedBlock: String(parsed.lastScannedBlock ?? ''),
      donations: Array.isArray(parsed.donations) ? parsed.donations : [],
    };
  } catch (err) {
    console.warn(`[state] could not parse ${STATE_PATH}: ${err.message}. Treating as missing.`);
    return null;
  }
}

function saveState(state) {
  const payload = {
    firstScanBlock: String(state.firstScanBlock),
    lastScannedBlock: String(state.lastScannedBlock),
    donations: state.donations,
  };
  writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2) + '\n');
}

function mergeDonations(existing, fresh) {
  const seen = new Set(existing.map((d) => d.hash));
  const out = existing.slice();
  for (const d of fresh) {
    if (!d.hash || seen.has(d.hash)) continue;
    seen.add(d.hash);
    out.push(d);
  }
  // Stable ordering: by block then hash.
  out.sort((a, b) => (a.blockNumber - b.blockNumber) || a.hash.localeCompare(b.hash));
  return out;
}

// ---------- Aggregation + markdown ----------

function aggregate(donations) {
  const map = new Map(); // from -> { totalWei, txCount, firstTs, lastTs }
  for (const d of donations) {
    const from = d.from.toLowerCase();
    const wei = BigInt(d.value);
    if (wei <= 0n) continue;
    if (from === DONATE_LC) continue; // self-transfer guard
    const ts = Number(d.ts) || 0;
    const cur = map.get(from) || { totalWei: 0n, txCount: 0, firstTs: ts, lastTs: ts };
    cur.totalWei += wei;
    cur.txCount += 1;
    cur.firstTs = Math.min(cur.firstTs || ts, ts);
    cur.lastTs = Math.max(cur.lastTs || ts, ts);
    map.set(from, cur);
  }
  return [...map.entries()]
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

// ---------- Main ----------

(async () => {
  const pool = makePool(BASE_RPCS);
  console.log(`[init] pool size: ${pool.size()} endpoint(s)`);

  const head = await getHead(pool);
  console.log(`[init] Base head block: ${head}`);

  const safeHead = head - REORG_BUFFER;
  if (safeHead <= 0) {
    throw new Error(`safe head is non-positive (head=${head}); bailing out`);
  }

  let state = loadState();
  let startBlock;
  let firstScanBlock;

  if (!state) {
    // First run — start from head - FIRST_RUN_LOOKBACK so we capture
    // anything that might have shipped in the last few minutes, but DO NOT
    // walk all of Base history (donate flow only shipped 2026-05-20).
    firstScanBlock = Math.max(1, head - FIRST_RUN_LOOKBACK);
    startBlock = firstScanBlock;
    console.log(`[init] no state file. Starting fresh at block ${firstScanBlock} (head - ${FIRST_RUN_LOOKBACK}).`);
  } else {
    firstScanBlock = Number(state.firstScanBlock);
    const last = Number(state.lastScannedBlock);
    startBlock = last + 1;
    console.log(`[init] resuming from block ${startBlock} (lastScanned=${last}, firstScan=${firstScanBlock}, prior donations=${state.donations.length}).`);
  }

  const endBlock = Math.min(safeHead, startBlock + MAX_BLOCKS_PER_RUN - 1);

  if (endBlock < startBlock) {
    console.log(`[scan] nothing to do — startBlock=${startBlock} > endBlock=${endBlock} (safeHead=${safeHead}). Up to date.`);
  } else {
    const range = endBlock - startBlock + 1;
    console.log(`[scan] walking blocks ${startBlock} -> ${endBlock} (${range.toLocaleString()} blocks, concurrency=${CONCURRENCY}).`);
    if (range >= MAX_BLOCKS_PER_RUN) {
      console.log(`[scan] hit per-run cap (${MAX_BLOCKS_PER_RUN.toLocaleString()}). Next run will continue from ${endBlock + 1}.`);
    }

    const t0 = Date.now();
    const fresh = await walkBlocks(pool, startBlock, endBlock, (done, total, pct) => {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = done / Math.max(elapsed, 0.001);
      const eta = (total - done) / Math.max(rate, 0.001);
      console.log(`[scan] ${pct}% (${done}/${total}) — ${rate.toFixed(1)} blocks/s — eta ${eta.toFixed(0)}s`);
    });
    console.log(`[scan] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — found ${fresh.length} new donation tx(s).`);

    const priorDonations = state?.donations ?? [];
    const mergedDonations = mergeDonations(priorDonations, fresh);
    state = {
      firstScanBlock: String(firstScanBlock),
      lastScannedBlock: String(endBlock),
      donations: mergedDonations,
    };
    saveState(state);
    console.log(`[state] wrote ${STATE_PATH} (lastScannedBlock=${endBlock}, totalDonations=${mergedDonations.length}).`);
  }

  // Generate output regardless of whether new blocks were scanned — so the
  // first cold run still produces a SUPPORTERS.md / README block.
  const donations = state?.donations ?? [];
  const rows = aggregate(donations);
  console.log(`[render] aggregated ${rows.length} unique supporters from ${donations.length} donation tx(s).`);

  const supportersMd = generateSupportersMd(rows);
  writeFileSync(SUPPORTERS_PATH, supportersMd);
  console.log(`[render] wrote ${SUPPORTERS_PATH}`);

  if (existsSync(README_PATH)) {
    const readme = readFileSync(README_PATH, 'utf8');
    const block = generateReadmeBlock(rows);
    const updated = injectIntoReadme(readme, block);
    if (updated !== readme) {
      writeFileSync(README_PATH, updated);
      console.log('[render] updated README.md supporters block.');
    } else {
      console.log('[render] README.md unchanged.');
    }
  }

  const snap = pool.snapshot();
  const skipped = snap.filter((s) => s.skipped);
  if (skipped.length > 0) {
    console.log(`[rpc] ${skipped.length}/${snap.length} endpoints were dropped this run: ${skipped.map((s) => s.url).join(', ')}`);
  }
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
