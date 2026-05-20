import { parseAbiItem } from 'viem';

// Clanker v4 factory event. tokenAddress and tokenAdmin are indexed —
// server-side filter on tokenAdmin gives us "tokens I deployed" cheaply.
export const TOKEN_CREATED_EVENT = parseAbiItem(
  'event TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address mevModule, uint256 extensionsSupply, address[] extensions)'
);
