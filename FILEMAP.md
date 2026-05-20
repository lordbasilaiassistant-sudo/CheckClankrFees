# File Map

A grep-able tour of every module in this project. If a behavior surprises you,
this is the first place to look. Keep this file in sync — if you add/move/delete
a file, update its row here in the same PR.

## Tree

```
.
├── index.html                       Bootstrap shell (single root div)
├── vite.config.js                   Build target es2022, sourcemap OFF in prod
├── package.json                     Public metadata (license, repo, keywords)
├── .env.example                     Every VITE_* var with what it does
├── .gitignore                       node_modules, dist, .env*, OS junk, OneDrive
├── .nvmrc                           Node version pin (20)
├── .editorconfig                    2-space, LF, UTF-8 across editors
├── LICENSE                          MIT
├── README.md                        Public landing — quick start, env, privacy
├── CONTRIBUTING.md                  How to file bugs / submit PRs
├── FILEMAP.md                       (this file)
├── docs/
│   └── ARCHITECTURE.md              Deep-dive for extenders
└── src/
    ├── main.jsx                     Boots React + wagmi + RpcAggregator preflight
    ├── App.jsx                      Shell — Header + (TokenList | EmptyState) + DebugPanel
    ├── constants.js                 Chain addresses, deploy block, scan defaults
    ├── styles.css                   All styles (no per-component CSS)
    │
    ├── lib/                         Pure library code — no React
    │   ├── debug.js                 Structured logger + ring buffer + window.__ccfLog
    │   ├── appkit.js                Reown AppKit + wagmi adapter setup
    │   ├── scanCache.js             localStorage cache (per address, 30d max-age)
    │   ├── rpc/                     RPC layer (aggregator + helpers)
    │   │   ├── index.js             Singleton + getBlockNumber/getLogs/multicall sugar
    │   │   ├── aggregator.js        RpcAggregator class — health, rotation, quorum
    │   │   ├── endpoints.js         Default free Base RPC pool (11 endpoints)
    │   │   ├── classify.js          isContractRevert() + looksLikeCors()
    │   │   └── quorum.js            sameJson() comparator for k-of-N reads
    │   └── clanker/                 Clanker-specific protocol code
    │       ├── events.js            TokenCreated ABI + parseTokenCreated()
    │       ├── sanitize.js          safeAddress, sanitizeText, HASH_RE_64
    │       ├── images.js            safeImageUrl — https/ipfs only
    │       ├── scan.js              findTokensByDeployer (chunked + cached scan)
    │       ├── rewards.js           availableFeesBatch (multicall)
    │       └── claim.js             buildClaimRequest (wagmi writeContract payload)
    │
    ├── hooks/                       Wagmi/state hooks around lib/
    │   ├── useTokenScan.js          Scan effect + StrictMode epoch guard
    │   ├── useFeeRewards.js         Multicall fee reads + per-row refresh()
    │   └── useClaimFees.js          wagmi useWriteContract + useWaitForTransactionReceipt
    │
    └── components/                  Presentational React, no on-chain calls
        ├── Header.jsx               Logo + connect button + debug toggle
        ├── EmptyState.jsx           "Connect your wallet" screen
        ├── TokenList.jsx            Container — orchestrates hooks, renders table
        ├── TokenRow.jsx             One row (image + name + ClaimCell + links)
        ├── ClaimCell.jsx            Claimable amount + inline Claim button + status
        └── DebugPanel.jsx           Right-side panel — RPC table + log stream
```

## Module index

### `src/lib/` — pure code

| Module | Exports | Used by |
|---|---|---|
| `debug.js` | `log`, `debugPanelEnabled` | everything |
| `appkit.js` | `appKit`, `wagmiConfig`, `projectId` | `main.jsx`, `Header` |
| `scanCache.js` | `readCache`, `writeCache`, `clearCache`, `CACHE_VERSION` | `clanker/scan.js` |
| `rpc/index.js` | `rpc` (singleton), `getBlockNumber`, `getLogs`, `readContract`, `multicall` | `main.jsx`, `clanker/scan.js`, `clanker/rewards.js`, `DebugPanel` |
| `rpc/aggregator.js` | `RpcAggregator` class | `rpc/index.js` |
| `rpc/endpoints.js` | `DEFAULT_BASE_RPCS` | `rpc/index.js` |
| `rpc/classify.js` | `isContractRevert`, `looksLikeCors` | `rpc/aggregator.js` |
| `rpc/quorum.js` | `sameJson` | `rpc/aggregator.js` |
| `clanker/events.js` | `TOKEN_CREATED_EVENT`, `parseTokenCreated` | `clanker/scan.js` |
| `clanker/sanitize.js` | `safeAddress`, `sanitizeText`, `HASH_RE_64` | `clanker/events.js` |
| `clanker/images.js` | `safeImageUrl` | `components/TokenRow` |
| `clanker/scan.js` | `findTokensByDeployer` | `hooks/useTokenScan` |
| `clanker/rewards.js` | `availableFeesBatch`, `FEE_LOCKER_ABI` | `hooks/useFeeRewards` |
| `clanker/claim.js` | `buildClaimRequest`, `FEE_LOCKER_CLAIM_ABI` | `hooks/useClaimFees` |

### `src/hooks/` — React state wrappers

| Hook | Returns | Used by |
|---|---|---|
| `useTokenScan(address)` | `{ tokens, progress, scanning, error, stop }` | `TokenList` |
| `useFeeRewards(address, tokenAddresses)` | `{ rewards, refresh(tokenAddr?) }` | `TokenList` |
| `useClaimFees({ feeOwner, token, onClaimed })` | `{ claim(), reset(), status, txHash, error }` | `ClaimCell` |

### `src/components/` — presentational

| Component | Props | Notes |
|---|---|---|
| `Header` | `debugOpen`, `onToggleDebug` | Uses `useAccount`/`useDisconnect` directly |
| `EmptyState` | — | Static "Connect your wallet" pitch |
| `TokenList` | `address` | Container — owns scan + rewards hooks |
| `TokenRow` | `token`, `reward`, `feeOwner`, `onClaimed` | Pure render |
| `ClaimCell` | `feeOwner`, `token`, `reward`, `onClaimed` | Owns one `useClaimFees` |
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
| New RPC endpoint | `src/lib/rpc/endpoints.js` |
| New on-chain read | `src/lib/clanker/<new>.js` + hook in `src/hooks/` |
| New on-chain write | `src/lib/clanker/<new>.js` + hook in `src/hooks/` |
| New chain support | New entry in `constants.js` + adapter in `rpc/endpoints.js` |
| New piece of UI | `src/components/<Name>.jsx`, props only, no on-chain calls |
| New env var | `.env.example` row + read in `constants.js` or relevant lib |

## Anti-patterns

- **No on-chain calls in `components/`** — always go through a `hooks/use*.js`.
- **No `useState` in `lib/`** — library code is React-agnostic.
- **No new singletons** — `rpc` is the only one; route through it.
- **No new RPC instances** — `createPublicClient` is called only inside `RpcAggregator`. Everything else uses `rpc.withClient/withQuorum`.
- **Never trust on-chain strings without `sanitizeText`** — they're user-controlled.
- **Never pass an arbitrary URL to `<img src>` without `safeImageUrl`** — same reason.
