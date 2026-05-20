// Plugin contract. Every launcher we support — Clanker, Doppler, Zora,
// custom-ERC-20 walker, etc. — implements this shape. The core scanner is
// completely plugin-agnostic: it iterates the registry, fans the calls
// across plugins, merges results.
//
// All addresses are checksummed. All amounts are bigints. All hashes are
// validated 0x… strings.
//
// Plugin module shape (default export):
//
//   export default {
//     id:    'clanker' | 'doppler' | ...,        // unique kebab-case
//     name:  'Clanker',                          // display
//     chains: [8453],                             // Base etc.
//
//     /**
//      * Discover launches that involve this wallet, by whatever means is
//      * cheapest for the protocol (indexed factory event, indexed Collect
//      * event, etc.). Implementations decide their own pagination.
//      *
//      * @param {`0x${string}`} address — connected wallet
//      * @param {object} [opts]
//      * @param {AbortSignal} [opts.signal]
//      * @param {(p: {scanned, total, fromBlock, toBlock, found}) => void} [opts.onProgress]
//      * @param {(cached: Launch[]) => void} [opts.onCached]
//      * @returns {Promise<Launch[]>}
//      */
//     async scanLaunches(address, opts) {},
//
//     /**
//      * Read current claimable amounts for many tokens at once. Should use
//      * Multicall3 where the protocol's read function supports it.
//      *
//      * @param {Launch[]} launches
//      * @param {object} args
//      * @param {`0x${string}`} args.feeOwner — connected wallet
//      * @returns {Promise<Record<token, Claimable>>}
//      */
//     async fetchClaimables(launches, args) {},
//
//     /**
//      * Build the wagmi `writeContract` request for claiming one launch's
//      * accrued fees. Pure — does not submit anything.
//      *
//      * @param {{ launch: Launch, feeOwner: `0x${string}` }} args
//      * @returns {WriteContractParameters}
//      */
//     buildClaimTx({ launch, feeOwner }) {},
//   };
//
// Launch shape:
//
//   {
//     pluginId:    'clanker',
//     token:       '0x…',                  // checksummed
//     name:        '…',                    // sanitized
//     symbol:      '…',                    // sanitized
//     image:       '…',                    // raw — render-time scheme-checked
//     deployedAt:  { blockNumber: bigint, txHash: '0x…' },
//     links:       [{ label: 'clanker', url: 'https://…', kind: 'protocol' }],
//     // arbitrary plugin-specific fields under `meta`:
//     meta:        { locker: '0x…', poolId: '0x…', ... },
//   }
//
// Claimable shape:
//
//   { amount: bigint, currency: 'ETH' | 'TOKEN' | '0x…', error?: string }
//
// Plugins are registered in src/lib/plugins/index.js.
export {}; // makes this an ES module
