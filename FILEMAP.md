# File Map

A grep-able tour of every module in this project. If a behavior surprises you,
this is the first place to look. Keep this file in sync — if you add/move/delete
a file, update its row here in the same PR.

## Tree

```
.
├── index.html                       Bootstrap shell + full SEO/OG meta
├── vite.config.js                   VITE_BASE for Pages, sourcemap OFF in prod
├── package.json                     Public metadata (license, repo, keywords)
├── .env.example                     Every VITE_* var with what it does
├── .gitignore                       node_modules, dist, .env*, OS junk, OneDrive
├── .nvmrc                           Node 20
├── .editorconfig                    2-space LF UTF-8
├── LICENSE                          MIT
├── README.md                        Public landing
├── CONTRIBUTING.md                  How to file bugs / submit PRs
├── FILEMAP.md                       (this file)
├── SUPPORTERS.md                    Auto-generated from on-chain donations
├── .github/workflows/
│   ├── pages.yml                    Build + deploy to GitHub Pages on push
│   └── supporters.yml               Daily refresh of SUPPORTERS.md
├── docs/
│   └── ARCHITECTURE.md              Deep-dive
├── public/
│   ├── robots.txt                   Crawler config
│   └── sitemap.xml
├── scripts/
│   └── update-supporters.mjs        Walks Base for donations, regenerates SUPPORTERS.md
└── src/
    ├── main.jsx                     Boots React + wagmi + RpcAggregator preflight
    ├── App.jsx                      Shell — Header + (TokenList | EmptyState) + DonateBox + DebugPanel
    ├── constants.js                 Shared chain defaults, donate address, GH URL
    ├── styles.css                   All styles
    │
    ├── lib/                         Pure code — no React
    │   ├── debug.js                 Structured logger + ring buffer + window.__ccfLog
    │   ├── appkit.js                Reown AppKit + wagmi adapter setup
    │   ├── scanCache.js             localStorage cache (key prefix v2: plugin × chain × addr, 30d max-age)
    │   ├── rpc/                     RPC layer
    │   │   ├── index.js             Singleton + getBlockNumber/getLogs (quorum)/multicall sugar
    │   │   ├── aggregator.js        RpcAggregator class — health, rotation, quorum, pre-flight
    │   │   ├── endpoints.js         Default free Base RPC pool (11 endpoints)
    │   │   ├── classify.js          isContractRevert() + looksLikeCors()
    │   │   └── quorum.js            sameJson() comparator for k-of-N reads
    │   ├── clanker/                 Shared validators (will move to lib/util/ later)
    │   │   ├── sanitize.js          safeAddress, sanitizeText, HASH_RE_64
    │   │   └── images.js            safeImageUrl — https/ipfs only
    │   └── plugins/                 Each launcher is one folder
    │       ├── types.js             Contract every plugin honors (jsdoc only)
    │       ├── index.js             PLUGINS array + pluginById / pluginsForChain
    │       ├── clanker/
    │       │   ├── index.js         Default export {id, name, chains, scanLaunches, fetchClaimables, buildClaimTx}
    │       │   ├── constants.js     Factory + FeeLocker addrs per chain
    │       │   ├── events.js        TokenCreated parsed ABI
    │       │   ├── discovery.js     scanLaunches — chunked, quorum'd, cached
    │       │   ├── rewards.js       fetchClaimables — multicall availableFees
    │       │   └── claim.js         buildClaimTx — FeeLocker.claim(owner, token)
    │       └── doppler/
    │           ├── index.js         Same shape; supportsClaim = false (uses doppler.lol)
    │           ├── constants.js     Airlock + StreamableFeesLocker v1 + v2
    │           ├── events.js        Collect, Create, Migrate ABIs
    │           ├── discovery.js     scanLaunches via indexed Collect.to + ERC-20 meta multicall
    │           ├── rewards.js       Sum beneficiariesClaims across v1 + v2 lockers
    │           └── claim.js         supportsClaim = false (deferred — links to doppler.lol)
    │
    ├── hooks/                       Wagmi/state wrappers around lib/
    │   ├── useTokenScan.js          Iterates PLUGINS in parallel, shared concurrency budget
    │   ├── useFeeRewards.js         Groups launches by pluginId, delegates to each plugin
    │   ├── useClaimFees.js          Asks pluginById(launch.pluginId).buildClaimTx
    │   └── useDonate.js             Native-ETH wagmi useSendTransaction → DONATE_ADDRESS
    │
    └── components/                  Presentational, no on-chain calls
        ├── Header.jsx               Logo + connect + GitHub + debug toggle
        ├── EmptyState.jsx           "Connect your wallet" screen
        ├── TokenList.jsx            Container — plugin filter chips, hide-empty toggle, sort by claimable DESC
        ├── TokenRow.jsx             One row — uses launch.links from the plugin
        ├── ClaimCell.jsx            Amount + claim button (or external-link fallback if !supportsClaim)
        ├── DonateBox.jsx            "Support dev" panel
        └── DebugPanel.jsx           Right-side panel — RPC table + log stream
```

## Module index

### `src/lib/` — pure code

| Module | Exports | Used by |
|---|---|---|
| `debug.js` | `log`, `debugPanelEnabled` | everything |
| `appkit.js` | `appKit`, `wagmiConfig`, `projectId` | `main.jsx`, `Header` |
| `scanCache.js` | `readCache`, `writeCache`, `clearCache`, `CACHE_VERSION` (=2) | plugins' `discovery.js` |
| `rpc/index.js` | `rpc` (singleton), `getBlockNumber`, `getLogs`, `readContract`, `multicall` | `main.jsx`, plugins, `DebugPanel`, `useTokenScan` |
| `rpc/aggregator.js` | `RpcAggregator` class | `rpc/index.js` |
| `rpc/endpoints.js` | `DEFAULT_BASE_RPCS` | `rpc/index.js` |
| `rpc/classify.js` | `isContractRevert`, `looksLikeCors` | `rpc/aggregator.js` |
| `rpc/quorum.js` | `sameJson` | `rpc/aggregator.js` |
| `clanker/sanitize.js` | `safeAddress`, `sanitizeText`, `HASH_RE_64` | every plugin's `discovery.js` |
| `clanker/images.js` | `safeImageUrl` | `components/TokenRow` |
| `plugins/types.js` | (jsdoc-only contract) | reference |
| `plugins/index.js` | `PLUGINS`, `pluginById`, `pluginsForChain` | hooks + components |
| `plugins/clanker/*` | default `{id, name, chains, scanLaunches, fetchClaimables, buildClaimTx}` | registry |
| `plugins/doppler/*` | default `{id, name, chains, scanLaunches, fetchClaimables, buildClaimTx, supportsClaim:false}` | registry |

### `src/hooks/` — React state wrappers

| Hook | Returns | Used by |
|---|---|---|
| `useTokenScan(address)` | `{ launches, perPluginProgress, scanning, error, stop }` | `TokenList` |
| `useFeeRewards(address, launches)` | `{ rewards, refresh(tokenAddr?) }` | `TokenList` |
| `useClaimFees({ launch, feeOwner, onClaimed })` | `{ claim(), reset(), status, txHash, error }` | `ClaimCell` |
| `useDonate({ onSent })` | `{ donate(amountEth), reset(), status, txHash, error }` | `DonateBox` |

### `src/components/` — presentational

| Component | Props | Notes |
|---|---|---|
| `Header` | `debugOpen`, `onToggleDebug` | `useAccount`/`useDisconnect` |
| `EmptyState` | — | "Connect your wallet" |
| `TokenList` | `address` | Owns the two scan/rewards hooks; plugin filter chips; sort by claimable DESC; hide-empty toggle |
| `TokenRow` | `launch`, `reward`, `feeOwner`, `onClaimed` | Pure; renders `launch.links` from the plugin |
| `ClaimCell` | `launch`, `feeOwner`, `reward`, `onClaimed` | Owns one `useClaimFees`; falls back to plugin's protocol link if `supportsClaim === false` |
| `DonateBox` | — | `useDonate`; hidden until connected |
| `DebugPanel` | `onClose` | Subscribes to `log` + `rpc.snapshot` |

## How data flows

```
   User connects wallet
        │
        ▼
   App.jsx (useAccount → address)
        │
        ▼
   TokenList(address)
        │
        ├──► useTokenScan(address)
        │      └─► clanker/scan.js → rpc/index.js (getLogs quorum) → 11 RPCs
        │
        └──► useFeeRewards(address, tokenAddresses)
               └─► clanker/rewards.js → rpc/index.js (multicall) → 11 RPCs
        │
        ▼
   TokenRow × N
        │
        └──► ClaimCell ──► useClaimFees ──► clanker/claim.js
                                              │
                                              ▼
                                          wagmi useWriteContract
                                              │
                                              ▼
                                          User wallet signs
                                              │
                                              ▼
                                          FeeLocker.claim() on-chain
                                              │
                                              ▼ (on receipt)
                                          onClaimed(token) → refresh(token)
```

## Adding new functionality — where things belong

| Add a… | Goes in… |
|---|---|
| **New launcher** (Zora, custom, etc.) | New folder `src/lib/plugins/<name>/` with `index.js` + `discovery.js` + `rewards.js` + `claim.js` + `constants.js` + `events.js`. Register in `plugins/index.js`. See `clanker/` as the reference impl. |
| New RPC endpoint | `src/lib/rpc/endpoints.js` |
| New on-chain read for an existing plugin | New file under that plugin's folder + use `rpc.withClient`/`multicall` |
| New on-chain write for an existing plugin | Same as read; expose in plugin's `claim.js` and flip `supportsClaim` if it was off |
| New chain for an existing plugin | Add chain id to the plugin's `constants.js` map AND to its `chains` array |
| New piece of UI | `src/components/<Name>.jsx`, props only, no on-chain calls (use a hook) |
| New env var | `.env.example` row + read in `constants.js` or the relevant lib |

## Anti-patterns

- **No on-chain calls in `components/`** — always go through a `hooks/use*.js`.
- **No `useState` in `lib/`** — library code is React-agnostic.
- **No new singletons** — `rpc` is the only one; route through it.
- **No new RPC instances** — `createPublicClient` is called only inside `RpcAggregator`. Everything else uses `rpc.withClient/withQuorum`.
- **Never trust on-chain strings without `sanitizeText`** — they're user-controlled.
- **Never pass an arbitrary URL to `<img src>` without `safeImageUrl`** — same reason.
