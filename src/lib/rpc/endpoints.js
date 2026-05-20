// Default free Base mainnet RPC pool. Ordered roughly by observed reliability
// from earlier sessions; the aggregator re-orders dynamically by health, so
// the order here only matters for "first-call cold start" before any data
// is collected.
//
// Endpoints that require an API key are deliberately omitted — set
// VITE_BASE_RPC_URL in .env to prepend a keyed endpoint to the pool.
export const DEFAULT_BASE_RPCS = [
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
