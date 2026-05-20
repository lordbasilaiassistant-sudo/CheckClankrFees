// Quorum / comparator helpers used by RpcAggregator.withQuorum.
//
// Comparing two getLogs responses: each is an array of event objects with
// nested BigInts. JSON.stringify with a BigInt replacer is stable, ordered
// (because Promise.allSettled preserves call-order) and fast enough for the
// small payloads getLogs returns.

export function sameJson(a, b) {
  try {
    return JSON.stringify(a, bigintReplacer) === JSON.stringify(b, bigintReplacer);
  } catch {
    return false;
  }
}

function bigintReplacer(_k, v) {
  return typeof v === 'bigint' ? v.toString() + 'n' : v;
}
