# Check Clankr Fees

**Live:** <https://lordbasilaiassistant-sudo.github.io/CheckClankrFees/>

**Find the money you forgot about on Base.** Connect your wallet, scan every token launcher you've used, see every claimable fee balance waiting for you in one ranked list — and claim it.

Each launcher is a small **plugin** in `src/lib/plugins/`. Today the registry ships with **Clanker v4** and **Doppler**; adding a new launcher is one folder. Toggle plugins with the chip strip at the top.

If you've ever wondered "wait, do any of these things I deployed have fees I forgot about?", this is for you.

## Screenshot
<img width="922" height="1048" alt="image" src="https://github.com/user-attachments/assets/22b36989-c699-4fe5-a659-b6e0323f05f0" />



## Why this exists

Most launcher UIs (`clanker.world`, `doppler.lol`, etc.) make you click into each token, one at a time, to see what you've earned. If you've deployed a handful of tokens across two protocols, you have to remember to check both — and the fees that sit unclaimed are easy to forget.

This tool flips it: connect once, and the app fans out across every supported launcher in parallel, surfaces the rows where you have a non-zero claimable balance, ranks them by size, and lets you claim directly inline.

**Read-only by default.** The only on-chain write is the explicit per-row "claim →" button — one wallet signature, one tx, one click. No auto-claim, no approvals, no surprises.

**"Forgotten money" mode** is on by default: tokens with 0 claimable are hidden so the screen shows only what you can actually grab right now.

### Plugins shipped today

| Plugin | What it covers | Discovery signal | Claim |
| --- | --- | --- | --- |
| **Clanker** v4 | tokens where you're the `tokenAdmin` at deploy time | `TokenCreated.tokenAdmin` (indexed) | ✅ in-app via `FeeLocker.claim()` |
| **Doppler** | tokens that have ever paid you fees on Doppler v1/v2 lockers | `Collect.to` (indexed) | ↗ defers to doppler.lol for now |

### Adding a new launcher

Drop a folder under [`src/lib/plugins/<name>/`](src/lib/plugins/) with `index.js`, `discovery.js`, `rewards.js`, `claim.js`, register it in [`src/lib/plugins/index.js`](src/lib/plugins/index.js). The rest of the app picks it up automatically. See [`src/lib/plugins/types.js`](src/lib/plugins/types.js) for the contract.

## Quick start

```bash
git clone https://github.com/<your-fork>/CheckClankrFees.git
cd CheckClankrFees
npm install
cp .env.example .env
# Open .env and paste a Reown project ID (see "Configuration" below).
# All other env vars are optional.
npm run dev
```

Then open <http://localhost:5173>, click **Connect Wallet**, and wait for the scan to finish. Subsequent visits are much faster — results are cached in your browser and only new blocks get scanned.

To produce a static build instead:

```bash
npm run build
npm run preview
```

The `dist/` output is a plain static bundle — host it anywhere (GitHub Pages, Cloudflare Pages, Netlify, your own nginx).

### Deploying to GitHub Pages

This repo ships with `.github/workflows/pages.yml` — every push to `main` builds the bundle with the `/CheckClankrFees/` subpath baked in and publishes to GitHub Pages.

To use it on your fork:

1. In repo Settings → Pages, set **Source** to "GitHub Actions".
2. (Optional, recommended) In Settings → Secrets and variables → Actions, add a repo secret `VITE_WALLETCONNECT_PROJECT_ID` with your free Reown project ID. Without it, browser-extension wallets still work but mobile QR pairing won't.
3. Push to `main`. The workflow runs; first successful deploy goes live at `https://<your-username>.github.io/CheckClankrFees/`.

## Configuration

All configuration is via `.env` (copy from `.env.example`). Because this is a Vite app, every variable is prefixed `VITE_` and is **public** — it ships in the JS bundle. Don't put secrets in here.

| Variable | Required? | What it does |
| --- | --- | --- |
| `VITE_WALLETCONNECT_PROJECT_ID` | yes for mobile / WalletConnect | Public Reown project ID. Browser-extension wallets (MetaMask, Rabby, etc.) work without it, but mobile QR pairing does not. Get one free at <https://cloud.reown.com> — sign up, create a project, paste the ID. |
| `VITE_BASE_RPC_URL` | no | A private Base RPC (Alchemy / QuickNode / Ankr). If set, it's tried first by the RPC aggregator. Useful if the free public RPCs are rate-limiting you. |
| `VITE_SCAN_FROM_BLOCK` | no | First Base block to scan. Defaults to `31526699` — the block where the Clanker v4 factory was first deployed. Raise it to scan a tighter window (faster, but you'll miss older tokens). |
| `VITE_SCAN_CHUNK` | no | Block range per `eth_getLogs` call. Defaults to `9999` (public-RPC cap is 10k). |
| `VITE_SCAN_CONCURRENCY` | no | How many chunk fetches run in parallel. Default `5`. Higher = faster but more rate-limit hits. |

## How it works

**1. Wallet connect.** Reown AppKit handles both browser-extension wallets and mobile (via WalletConnect v2 QR / deep link). You connect once; the app reads your address and never asks you to sign.

**2. Factory log scan.** Once it has your address, the app chunks through the Clanker v4 factory's `TokenCreated` event log on Base mainnet, filtered server-side to events where the indexed `tokenAdmin` matches you. Each chunk goes through an RPC aggregator that rotates across 11 free public Base endpoints — a single flaky RPC just causes the next one in line to take over. Results are cached in `localStorage`, so when you come back tomorrow it only scans the blocks mined since your last visit.

**3. Multicall to FeeLocker.** For every token found, the app batches `availableFees(feeOwner, token)` reads against the Clanker v4 FeeLocker (`0xF3622742b1E446D92e45E22923Ef11C2fcD55D68`) through Multicall3 — one round-trip for all tokens. The number you see in the "Claimable" column is whatever the locker says you can withdraw right now.

## Privacy & safety

- **Two transaction surfaces only.** (1) Wallet connect (one-time `eth_requestAccounts`). (2) The optional "claim →" button per row, which submits a single `FeeLocker.claim(yourAddress, token)` transaction for *that one token*. There is no auto-claim, no `approve`, no `personal_sign`, no `signTypedData`, no contract-write of any kind beyond the explicit user-click claim. The entire codebase only has one call to `useWriteContract` (in `src/hooks/useClaimFees.js`).
- **All data stays local.** Scan results are cached in your browser's `localStorage` (key prefix `ccf:scan:v1:`, max-age 30 days). No server, no backend, no account. Clear the cache by clearing site data for `localhost:5173` (or whatever origin you host it at).
- **App-level telemetry: none.** No analytics SDK is bundled in this code. The Reown AppKit `features.analytics: false` flag is set in `src/lib/appkit.js`. Be aware that AppKit's own connect-time traffic still hits `pulse.walletconnect.org` / `verify.walletconnect.com` / `api.web3modal.org` for the WalletConnect protocol itself (relay, wallet metadata, connect-attempt verification) — that's a property of the AppKit dependency, not data this app sends.
- **A note on `VITE_BASE_RPC_URL`.** If you put a private RPC URL with an API key in `.env`, that URL **gets baked into the JS bundle** at build time. Anyone with access to your built site can extract the URL+key. This is fine for local dev; if you host publicly, use a free public RPC or a domain-scoped key.
- **Bundle is auditable.** Production builds ship without sourcemaps to keep size down (`sourcemap: false` in `vite.config.js`), but the unminified source is right here in `src/` and the network tab during `npm run dev` shows every outbound request. There's nothing hidden.

## Troubleshooting

**"Connect Wallet" does nothing / mobile QR doesn't appear.**
You probably forgot to put a value in `VITE_WALLETCONNECT_PROJECT_ID`. Get one at <https://cloud.reown.com>, paste it into `.env`, and restart `npm run dev`. The browser console will also log a `[ccf:appkit]` warning when the ID is empty.

**Scan stalls or "all endpoints failed for getLogs".**
Public RPCs sometimes all rate-limit at once. Wait 60 seconds — the aggregator revives banned endpoints after a 60s cooldown — and click rescan. If it's persistent, add a private RPC to `VITE_BASE_RPC_URL`.

**Some tokens show `0` claimable but you're sure there's something there.**
Open the debug panel (append `?debug=1` to the URL, or click the 🐛 button) and look at the `rewards` log scope. A revert from `availableFees` will show up there — typically it means that particular token uses a non-standard fee shape that the v4 FeeLocker doesn't own.

**Scan is slow on first run.**
First visit scans ~15M blocks of factory history. On a fresh cache expect a few minutes. After the first run, only the newly-mined delta is scanned (usually seconds).

**"VITE_WALLETCONNECT_PROJECT_ID is empty" warning in console.**
Same as the first item — set it in `.env`.

## Architecture

```
                         +------------------+
   browser wallet ─────► |  Reown AppKit    |  ◄─── mobile wallet (QR / deep link)
   (MetaMask, etc.)      +------------------+
                                  │
                                  ▼
                         +------------------+
                         |  wagmi / viem    |
                         +------------------+
                                  │
                                  ▼
                         +------------------+
                         |  RpcAggregator   |     (src/lib/rpc/)
                         |  11 endpoints    |
                         |  health-ranked   |
                         +------------------+
                          │      │       │
              ┌───────────┘      │       └────────────┐
              ▼                  ▼                    ▼
      +---------------+   +--------------+    +----------------+
      |  Base public  |   |  Multicall3  |    |  Clanker v4    |
      |  RPC pool     |   |  0xcA11bde…  |    |  FeeLocker     |
      |  (eth_getLogs)|   |  aggregate3  |    |  availableFees |
      +---------------+   +--------------+    +----------------+
              │                  │                    │
              ▼                  ▼                    ▼
        TokenCreated      batched calls         per-token
        events for         (one RPC trip          claimable
        your address       for N tokens)          balance
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the deeper-dive.

## Contributing

PRs and issues welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) — short read.

Particularly useful contributions:

- Additional free Base RPC endpoints to widen the aggregator pool.
- Support for additional chains where Clanker is deployed.
- Better debug UX (filtering, export).
- Bug reports with the `?debug=1` log attached.

<!-- SUPPORTERS:START -->

## Supporters

Auto-tracked from on-chain donations to the maintainer's Base address. Full list in [`SUPPORTERS.md`](SUPPORTERS.md).

_No supporters yet — be the first via the "Support dev" panel on the live site._

<!-- SUPPORTERS:END -->

## License

MIT. See [`LICENSE`](LICENSE).
