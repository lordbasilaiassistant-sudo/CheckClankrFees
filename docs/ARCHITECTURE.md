# Architecture

A deeper look at how Check Clankr Fees is wired, for people who want to extend it. Pairs with the high-level diagram in the [README](../README.md#architecture).

For the file tree and "where does new code go?" tables, see [`FILEMAP.md`](../FILEMAP.md).

## Layering

```
components/  ──► hooks/  ──► lib/    ──► chain
(presentational)  (React)    (pure JS)    (Base RPCs)
```

- `src/components/` — render-only. Never imports from `viem`/`wagmi`/`@reown`. Never calls `useState` for chain data — that lives in hooks.
- `src/hooks/` — wraps `lib/` calls in React state. The only place `wagmi`'s `useWriteContract`/`useAccount`/`useWaitForTransactionReceipt` are called.
- `src/lib/` — pure modules, no React. Safe to unit-test or reuse in a Node script.
- `src/constants.js` — every magic address / block number / default.

## The RPC aggregator state machine

Source: [`src/lib/rpc/aggregator.js`](../src/lib/rpc/aggregator.js), with helpers in [`classify.js`](../src/lib/rpc/classify.js), [`quorum.js`](../src/lib/rpc/quorum.js), and the singleton in [`index.js`](../src/lib/rpc/index.js).

Free public RPCs are the reliability story for this app — any one of them will rate-limit, time out, or 502 under sustained load. The aggregator papers over that with health-tracked rotation.

### States

| State | Meaning | Transition into | Transition out |
| --- | --- | --- | --- |
| `healthy` | Last call succeeded, or never tried. Eligible for routing. | initial state; from `cooling` after `COOL_BAN_HALFLIFE_MS` (30s) with no further failures; from `banned` via revive. | → `cooling` on any network failure. → `banned` on 3 consecutive failures. |
| `cooling` | Last call failed within ~30s. Deprioritised but still eligible. | from `healthy` on a single network failure. | → `healthy` after 30s with no further failure. → `banned` on 3 consecutive failures. |
| `banned` | Hit `CONSECUTIVE_FAIL_BAN` (3) in a row. Skipped entirely while banned. | from `cooling` on 3rd consecutive fail. | → `cooling` after `BAN_COOLDOWN_MS` (60s) via `_reviveBanned()`. Counter resets. |
| `disabled` | Endpoint failed preflight with a CORS-like error. **Permanent for the session.** | only from `preflight()` when `looksLikeCors(err)` matches. | never. A page reload re-runs preflight. |

`disabled` is the only terminal state — CORS rejections can't recover within a browser session.

### What counts as a failure

Only network/transport failures count against endpoint health. **Contract reverts do not.** A revert means the chain answered; the RPC did its job. [`classify.js`](../src/lib/rpc/classify.js) walks the viem error chain (`ContractFunctionRevertedError`, `ContractFunctionExecutionError`, `ContractFunctionZeroDataError`) and falls back to a string-sniff. If it matches, the call credits the endpoint as healthy and re-throws the revert.

Don't undo this without a replacement signal — in an earlier iteration, `availableFees` reverts banned `mainnet.base.org` after 248 successes.

### Routing order

`_order()` ranks the pool every call:

1. **State**: healthy < cooling < banned. `disabled` is filtered out entirely.
2. **In-flight count**: prefer the endpoint serving the fewest concurrent calls. Forces fan-out for parallel workers.
3. **Private flag**: a user-supplied `VITE_BASE_RPC_URL` outranks public ones at equal health/load.
4. **EMA latency**: lower wins. `prev * 0.7 + current * 0.3`.
5. **Total ok count**: tiebreaker, higher wins.

### Quorum reads for `getLogs`

`rpc.withQuorum(label, fn, { k=2 })` is the anti-poisoning layer: fire `fn` at `k` different endpoints in parallel and only return once they unanimously agree. On disagreement, fire a tiebreaker to a non-seed endpoint and return whichever side it matches. If the tiebreaker disagrees with *every* seed, log it loudly and return the tiebreaker — that's a strong signal that one of the seeds is lying.

`getLogs` always goes through quorum (k=2 by default). Override with `VITE_GETLOGS_QUORUM=1` for raw single-source speed; you trade off "single malicious public RPC can forge TokenCreated events → phishing clanker.world link" for ~2× scan throughput.

### Public surface (from `src/lib/rpc/index.js`)

- `rpc.withClient(label, fn)` — try `fn(viemClient)` against the pool in order until one transport-succeeds.
- `rpc.withQuorum(label, fn, { k, equal })` — require k-of-N agreement.
- `rpc.preflight({ timeoutMs })` — one-time `eth_blockNumber` probe per endpoint at app boot.
- `rpc.snapshot()` / `rpc.subscribe(fn)` — for the debug panel.
- `rpc.healthyCount()` — used by the scanner for concurrency sizing.
- Sugar: `getBlockNumber()`, `getLogs(params)` (quorum), `readContract(params)`, `multicall(params)`.

## The scan cache contract

Source: [`src/lib/scanCache.js`](../src/lib/scanCache.js).

### Key shape

```
ccf:scan:v<CACHE_VERSION>:<address-lowercased>
```

Example: `ccf:scan:v1:0xyouraddresshere`.

### Value shape

```jsonc
{
  "v": 1,                                  // CACHE_VERSION
  "tokens": [
    {
      "token": "0x…",
      "name": "…",
      "symbol": "…",
      "image": "…",
      "locker": "0x…",
      "blockNumber": "31526702",           // bigint as decimal string
      "txHash": "0x…",
      "...": "…"
    }
  ],
  "scannedToBlock": "32100000",            // bigint as decimal string
  "scannedAt": 1747756800000               // unix ms
}
```

### Invalidation

- **Version mismatch** (`parsed.v !== CACHE_VERSION`): treated as no cache; fresh scan from `FACTORY_DEPLOY_BLOCK`. **Bump `CACHE_VERSION`** whenever the event signature, parser shape, or scan semantics change.
- **Max-age (`CACHE_MAX_AGE_MS` = 30 days)**: caches older than 30 days are discarded on read. This is a self-heal for a future version that adds a field but forgets to bump `CACHE_VERSION` — in 30 days at most, the stale entry expires on its own.
- **Aborted scans do not persist.** `findTokensByDeployer` only calls `writeCache` after a full successful run.
- **Manual clear**: `clearCache(address)` removes the entry. Users can also clear site data in their browser.

### Resume semantics

On a returning visit, `findTokensByDeployer`:

1. Reads the cache and immediately fires `onCached(tokens)` so the UI renders before any RPC call.
2. Sets `fromStart = max(scannedToBlock + 1, FACTORY_DEPLOY_BLOCK)`.
3. Asks for the current head block via `getBlockNumber()`.
4. If `fromStart > head`, returns the cached set with no scan.
5. Otherwise scans only `[fromStart, head]` and merges results.

Merged set is deduped by lowercased token address (defense in depth).

## The Clanker v4 event & factory address

Source: [`src/lib/clanker/events.js`](../src/lib/clanker/events.js), addresses in [`src/constants.js`](../src/constants.js).

```
Factory:      0xE85A59c628F7d27878ACeB4bf3b35733630083a9
First block:  31_526_699n (Clanker v4 factory's first byte of code on Base)
Event:        TokenCreated(
                  address msgSender,
                  address indexed tokenAddress,
                  address indexed tokenAdmin,
                  string tokenImage,
                  string tokenName,
                  string tokenSymbol,
                  string tokenMetadata,
                  string tokenContext,
                  int24  startingTick,
                  address poolHook,
                  bytes32 poolId,
                  address pairedToken,
                  address locker,
                  address mevModule,
                  uint256 extensionsSupply,
                  address[] extensions
              )
```

### Why the address is in `constants.js`, not env-configurable

1. **One Clanker v4 factory per chain.** No scenario in normal operation where this address changes mid-session.
2. **A wrong factory silently returns zero tokens.** Surfacing it via env var is a footgun. When v5 ships or another chain is added, extend `constants.js` — don't push the choice onto users.

### Why every field of the event is in the parsed ABI

viem won't decode a partial event signature — the topic0 hash is computed over the full signature including `extensions[]`. Drop any field and `getLogs` either silently returns nothing (topic0 mismatch) or fails to decode. If Clanker emits a new event with one extra parameter, this string needs the new parameter — and you need to bump `CACHE_VERSION`.

### Server-side filtering by `tokenAdmin`

`tokenAdmin` is **indexed**, so we filter on the RPC before the response leaves the node:

```js
await getLogs({
  address: CLANKER_V4_FACTORY,
  event:   TOKEN_CREATED_EVENT,
  args:    { tokenAdmin: userAddr },
  fromBlock, toBlock,
});
```

Without this filter we'd download every `TokenCreated` event on Base and filter client-side — orders of magnitude slower.

### Adaptive chunking

[`scan.js`](../src/lib/clanker/scan.js) → `scanRange(userAddr, from, to, label)` calls `getLogs` for the range. On failure (after the aggregator has exhausted every endpoint), it halves the range and recurses both halves in parallel. Recursion floor is `MIN_CHUNK = 500n`; below that, the chunk is logged + skipped rather than retried forever.

### Parsed token = UI-safe token

[`parseTokenCreated`](../src/lib/clanker/events.js) does input hardening on every event:

- Address fields go through `safeAddress` (viem checksum cast; null if malformed).
- `txHash` and `poolId` must match `/^0x[0-9a-f]{64}$/i`.
- `tokenName` / `tokenSymbol` go through `sanitizeText` — strips C0/C1 controls, zero-width chars, and bidi overrides; truncates to 64/16 chars. Defends against UI spoofing (e.g. RTL overrides flipping a row).
- `tokenImage` is left as a raw string but gets `safeImageUrl`-checked at render time (https/ipfs only).
- If any critical field is malformed, the entire event is **discarded** rather than rendered with holes.

## The multicall flow

Source: [`src/lib/clanker/rewards.js`](../src/lib/clanker/rewards.js).

After the scan returns N tokens, `availableFeesBatch({ feeOwner, tokens })` does:

1. Build N viem call objects, all pointing at the same FeeLocker (`0xF3622742…0d68` on Base) with `availableFees(feeOwner, token)`.
2. `client.multicall({ contracts: calls, allowFailure: true, batchSize: 50 })` — viem batches these into `Multicall3.aggregate3()` calls at the universal address `0xcA11bde0…6CA11`. `allowFailure: true` returns per-call status instead of throwing.
3. Map results into `{ [tokenAddr]: { amount: bigint } | { amount: 0n, error } }`.

If multicall itself fails entirely (every aggregator endpoint failing on the same call — rare), `availableFeesFallback` loops per-token with separate `readContract` calls so the UI doesn't blank out on a flap.

**Note**: the per-token `locker` field emitted in `TokenCreated` is the **LP Locker** (one per token, holds liquidity positions). The **FeeLocker** is a separate, singleton contract per chain that holds the claimable fee balances. Don't conflate them — claim goes against the FeeLocker.

## The claim flow

Source: [`src/lib/clanker/claim.js`](../src/lib/clanker/claim.js) + [`src/hooks/useClaimFees.js`](../src/hooks/useClaimFees.js) + [`src/components/ClaimCell.jsx`](../src/components/ClaimCell.jsx).

```
ClaimCell                   useClaimFees                   buildClaimRequest
  click "claim →"  ───────► claim()                ─────►  FeeLocker.claim(owner, token)
                              │                              │
                              ▼                              ▼
                          wagmi.useWriteContract      viem writeContract config
                              │
                              ▼
                          user wallet signs
                              │
                              ▼
                          tx hash returned
                              │
                              ▼
                          useWaitForTransactionReceipt
                              │ (on confirm)
                              ▼
                          onClaimed(token)
                              │
                              ▼
                          useFeeRewards.refresh(token)
```

The button only shows when `availableFees > 0`. Status cycles `idle → pending → confirming → done` (or → `error`). On success, the parent re-reads just that row's fee (which should be 0 now) — no full rescan.

**Why we don't auto-batch.** A single multicall write of "claim N tokens" would require a paymaster or an approval dance. Per-token claims are one signature each, but every click is explicit user consent. That tradeoff goes in the direction of "user is always in control" for a wallet-touching tool.

## The debug panel and `window.__ccfLog`

Source: [`src/lib/debug.js`](../src/lib/debug.js) and [`src/components/DebugPanel.jsx`](../src/components/DebugPanel.jsx).

### Log records

```js
{
  id:    1,                  // monotonic
  ts:    1747756800000,      // unix ms
  level: 'info',             // 'debug' | 'info' | 'warn' | 'error'
  scope: 'scan',             // 'boot' | 'wallet' | 'appkit' | 'rpc' | 'scan' | 'rewards' | 'cache' | 'claim' | 'list' | 'window'
  msg:   'head block',
  data:  { head: '32100000' } | null,
  durMs: 12.4                // present only on records produced by log.time(...)
}
```

A 1000-record ring buffer protects against runaway memory. Every line also goes to console with prefix `[ccf:<scope>]` so DevTools filtering works.

### `log.time(scope, msg, data)`

```js
const end = log.time('rewards', `multicall availableFees × ${tokens.length}`);
// ...do the work...
end({ ok: okCount, reverted: revertCount });
```

The closing record carries `durMs`.

### Enabling the on-screen panel

`debugPanelEnabled()` returns true when either:

- the URL has `?debug=1`, or
- `localStorage.ccf_debug === '1'` (sticky across reloads).

The 🐛 button in the header toggles manually regardless.

### `window.__ccfLog` API

Exposed in browsers for ad-hoc DevTools work:

| Call | Returns |
| --- | --- |
| `window.__ccfLog.snapshot()` | Copy of current ring buffer. |
| `window.__ccfLog.subscribe(fn)` | Calls `fn(snapshot)` immediately and on every new record. Returns unsubscribe. |
| `window.__ccfLog.clear()` | Empty + notify. |
| `window.__ccfLog.debug/info/warn/error(scope, msg, data?)` | Push manually. |
| `window.__ccfLog.time(scope, msg, data?)` | Returns `done(extra?, level?)` thunk. |

### Window error hooks

`debug.js` wires `window.addEventListener('error', …)` and `'unhandledrejection'` so silent failures land in the panel under `scope: 'window'`.

## Extending to a new chain

1. Add the chain to `networks` in [`src/lib/appkit.js`](../src/lib/appkit.js) (import from `@reown/appkit/networks`).
2. In [`src/constants.js`](../src/constants.js), turn `CLANKER_V4_FACTORY`, `FEE_LOCKER_BASE`, and `FACTORY_DEPLOY_BLOCK` into per-chain maps keyed by chain id. The Clanker SDK ships the same addresses for Sepolia, Arbitrum, Unichain, BNB, and Monad — see `clanker-sdk/dist/v4/index.js` for the canonical list.
3. Add a chain-appropriate RPC pool to [`src/lib/rpc/endpoints.js`](../src/lib/rpc/endpoints.js) (or split it per-chain).
4. **Bump `CACHE_VERSION`** in [`src/lib/scanCache.js`](../src/lib/scanCache.js) — old caches were chain-implicit, new ones need to be chain-explicit (probably also key the cache by chain id).
5. Verify the factory deploy block on the new chain (binary-search `getBytecode`) and put it in the per-chain config so first-time scans don't waste calls on pre-deploy blocks.

PRs welcome — see [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the rest.
