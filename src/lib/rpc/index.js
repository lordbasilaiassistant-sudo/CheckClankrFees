// Public entry point for the RPC layer. Everywhere in the app that wants
// to talk to Base does it through these helpers — never directly via viem.
//
// Why a singleton: the aggregator's per-endpoint health stats are global
// for this browser tab. Two independent instances would each have to learn
// "endpoint X is rate-limiting us" separately, doubling the failure cost.

import { RpcAggregator } from './aggregator.js';
import { DEFAULT_BASE_RPCS } from './endpoints.js';
import { DEFAULT_LOGS_QUORUM } from '../../constants.js';

function buildEndpoints() {
  const endpoints = [];
  const privateUrl = (import.meta.env?.VITE_BASE_RPC_URL || '').trim();
  if (privateUrl) endpoints.push({ url: privateUrl, isPrivate: true });
  for (const url of DEFAULT_BASE_RPCS) endpoints.push({ url, isPrivate: false });
  return endpoints;
}

/** Shared aggregator instance for the whole app. */
export const rpc = new RpcAggregator({ endpoints: buildEndpoints() });

// Quorum factor for getLogs is configurable via VITE_GETLOGS_QUORUM. 1 =
// off (single-source, faster); 2 = on (default — defends against a single
// malicious public RPC).
const QUORUM_K = (() => {
  const env = Number(import.meta.env?.VITE_GETLOGS_QUORUM);
  if (Number.isFinite(env) && env >= 1) return env;
  return DEFAULT_LOGS_QUORUM;
})();

// -- Sugar helpers — every caller goes through these ----------------------

export const getBlockNumber = () => rpc.withClient('getBlockNumber', (c) => c.getBlockNumber());

export const getLogs = (params) => {
  const label = `getLogs[${params.fromBlock}-${params.toBlock}]`;
  if (QUORUM_K <= 1) return rpc.withClient(label, (c) => c.getLogs(params));
  return rpc.withQuorum(label, (c) => c.getLogs(params), { k: QUORUM_K });
};

export const readContract = (params) => rpc.withClient(
  `readContract[${params?.functionName || 'call'}]`,
  (c) => c.readContract(params),
);

export const multicall = (params) => rpc.withClient(
  `multicall[${params?.contracts?.length || 0} calls]`,
  (c) => c.multicall(params),
);
