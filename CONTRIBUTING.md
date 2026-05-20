# Contributing

Thanks for considering a contribution. This is a small, focused tool — keep PRs small and focused too and they'll get reviewed fast.

The file layout (and where new code belongs) is in [`FILEMAP.md`](FILEMAP.md). Read it once before opening a PR.

## Filing a bug

Open a GitHub issue with:

1. **What you did.** "Connected wallet `0xYourAddressHere`, clicked Rescan."
2. **What you expected.** "Token list to populate."
3. **What actually happened.** "Spinner ran for 2 minutes then said 'all endpoints failed'."
4. **A debug log.** Append `?debug=1` to the URL, reproduce the bug, then run `window.__ccfLog.snapshot()` in DevTools console and paste the JSON. Redact any wallet addresses you don't want public — but the more of the log, the easier the debug.
5. **Environment.** Browser + OS, whether you set a private `VITE_BASE_RPC_URL`, and whether the failure is consistent or intermittent.

Please don't paste private RPC URLs into a public issue.

## Running locally

```bash
git clone https://github.com/<your-fork>/CheckClankrFees.git
cd CheckClankrFees
npm install
cp .env.example .env       # paste a Reown project ID (free at cloud.reown.com)
npm run dev
```

Then visit <http://localhost:5173>. Append `?debug=1` for the live debug panel.

There's no test suite yet (the app is mostly a thin client over Base RPCs — most "tests" are visual). If you add non-trivial pure logic (parsers, cache, aggregator state machine, quorum comparator), please add a small test alongside it.

## Kinds of PR that are welcome

- **More RPCs.** New free Base endpoints in `src/lib/rpc/endpoints.js`. Please verify the endpoint allows CORS from `http://localhost:5173` and supports `eth_getLogs` over a 10k-block range before submitting.
- **Better debug UX.** Filtering by scope/level, exporting the log as JSON, copy-to-clipboard from the panel, dark/light toggle for the panel.
- **Additional chains.** The factory + FeeLocker addresses for Base mainnet live in `src/constants.js`; the Clanker SDK has the same addresses for Sepolia, Arbitrum, Unichain, BNB, etc. A clean PR factors per-chain config into `constants.js` and lets the user pick the chain from the AppKit network switcher.
- **More on-chain reads.** Token holder counts, recent trade volume, pool liquidity — anything that helps a creator decide which tokens are worth their attention. Build new readers under `src/lib/clanker/`.
- **More on-chain writes.** Bulk-claim (one approval, N claims via Multicall write batching), claim-and-swap, scheduled claim alerts. New writers in `src/lib/clanker/` + corresponding `src/hooks/use*.js`.
- **Performance.** Cache compression, smarter resume logic, dynamic chunk sizing.
- **Docs.** Typo fixes, clearer explanations, screenshots, animated GIFs of the flow.

## Kinds of PR that are unlikely to land

- Anything that adds a backend, hosted service, or account system. This app is intentionally client-only.
- Telemetry / analytics, even "anonymous." The privacy posture is a feature.
- Auto-claim / auto-sign flows that bypass an explicit user click per transaction. Every signature must be a deliberate action.
- Heavy dependencies for problems that one helper function would solve.

## Style

- The codebase is plain JS (no TypeScript) and uses ES modules.
- Two-space indent, single quotes, semicolons.
- Comments explaining *why* are gold. Comments restating *what* (when *what* is obvious from the code) are noise.
- Keep new files small and single-purpose. The existing modules in `src/lib/` are the target size.

## Architectural rules (see FILEMAP.md for the why)

- **No on-chain calls in `src/components/`** — always go through a hook in `src/hooks/`.
- **No `useState` in `src/lib/`** — library code is React-agnostic.
- **Never trust on-chain strings without `sanitizeText`** — they're attacker-controlled.
- **Never pass an arbitrary URL to `<img src>` without `safeImageUrl`** — same reason.
- **No new `createPublicClient` calls** — everything talks to the chain through `rpc.withClient` or `rpc.withQuorum`. This is how the aggregator's health tracking works.

## Adding a new RPC endpoint

Edit `DEFAULT_BASE_RPCS` in `src/lib/rpc/endpoints.js`. Then:

1. Run `npm run dev`.
2. Open <http://localhost:5173/?debug=1>.
3. Connect a wallet and watch the `rpc` scope in the debug panel.
4. Confirm your endpoint shows up, gets called, and serves at least one successful response. If it's flagged `cors` after preflight, it's blocking CORS — won't work in a browser app.

## Commit messages

Short imperative subject line ("add base.gateway.tenderly.co to RPC pool"), optional body explaining the *why*. No conventional-commits ritual required.

## License

By submitting a PR you agree your contribution is licensed under the project's MIT license (see `LICENSE`).
