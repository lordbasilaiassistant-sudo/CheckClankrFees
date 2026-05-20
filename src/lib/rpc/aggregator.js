// RPC aggregator. Pool of endpoints, per-endpoint health, rotation on
// failure. The lifecycle of an endpoint:
//
//   healthy ──fail──► cooling ──3 consec fails──► banned ──60s──► healthy
//      │                                                                ▲
//      └──CORS fail at preflight──► disabled (permanent, never tried)──┘
//
// Public API:
//   - new RpcAggregator({ endpoints, chain }) → instance
//   - withClient(label, fn) — try fn against the healthiest endpoint; walk
//     on transport failure; re-throw contract reverts (RPC is healthy).
//   - withQuorum(label, fn, {k, equal}) — require k endpoints to agree
//     before returning. Tiebreaker on disagreement. Anti-pool-poisoning.
//   - preflight() — probe every endpoint with eth_blockNumber and disable
//     anything that CORS-fails from this origin.
//   - snapshot() / subscribe(fn) — for the DebugPanel.
//   - healthyCount() — for scan concurrency sizing.

import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { log } from '../debug.js';
import { isContractRevert, looksLikeCors } from './classify.js';
import { sameJson } from './quorum.js';

// 3 consecutive failures used to trigger a ban — too strict for public RPCs
// under sustained scan load. Mainnet.base.org would accumulate 129 ok / 21
// fail and still get banned because the LAST 3 happened to be fails (rate
// limit pulse, then 60s of empty pool). Bumping to 8 catches genuinely
// dead endpoints while letting transient flakes recover via the success
// counter without losing the endpoint mid-scan.
const CONSECUTIVE_FAIL_BAN = 8;
const BAN_COOLDOWN_MS = 30_000;       // halved — revival happens sooner if we do hit it
const COOL_BAN_HALFLIFE_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;

function makeEndpoint(url, index, isPrivate, chain) {
  return {
    url, index, isPrivate,
    state: 'healthy',                  // 'healthy' | 'cooling' | 'banned' | 'disabled'
    ok: 0, fail: 0, consecutiveFail: 0,
    emaMs: null, lastMs: null,
    inFlight: 0,
    lastError: null, lastErrorAt: null,
    bannedUntil: 0,
    client: createPublicClient({
      chain,
      transport: http(url, { timeout: REQUEST_TIMEOUT_MS, retryCount: 0 }),
    }),
  };
}

function shortUrl(u) { try { return new URL(u).host; } catch { return u; } }

export class RpcAggregator {
  constructor({ endpoints, chain = base }) {
    this.endpoints = endpoints.map(({ url, isPrivate }, i) => makeEndpoint(url, i, !!isPrivate, chain));
    this.subs = new Set();
    log.info('rpc', `aggregator ready with ${this.endpoints.length} endpoints`, {
      private: this.endpoints.filter((e) => e.isPrivate).length,
      pool: this.endpoints.map((e) => e.url),
    });
  }

  // -- Observability --------------------------------------------------------

  snapshot() {
    return this.endpoints.map((e) => ({
      url: e.url, index: e.index, isPrivate: e.isPrivate,
      state: e.state, ok: e.ok, fail: e.fail, consecutiveFail: e.consecutiveFail,
      emaMs: e.emaMs, lastMs: e.lastMs, inFlight: e.inFlight,
      lastError: e.lastError, lastErrorAt: e.lastErrorAt, bannedUntil: e.bannedUntil,
    }));
  }
  subscribe(fn) { this.subs.add(fn); fn(this.snapshot()); return () => this.subs.delete(fn); }
  _notify() { const snap = this.snapshot(); for (const fn of this.subs) try { fn(snap); } catch {} }

  healthyCount() {
    this._reviveBanned();
    return this.endpoints.filter((e) => e.state !== 'banned' && e.state !== 'disabled').length;
  }

  // -- Health state machine -------------------------------------------------

  _reviveBanned() {
    const now = Date.now();
    for (const e of this.endpoints) {
      if (e.state === 'disabled') continue; // permanent
      if (e.state === 'banned' && now >= e.bannedUntil) {
        log.info('rpc', `reviving banned endpoint after cooldown`, { url: e.url });
        e.state = 'cooling'; e.consecutiveFail = 0;
      }
      if (e.state === 'cooling' && e.lastErrorAt && (now - e.lastErrorAt) > COOL_BAN_HALFLIFE_MS) {
        e.state = 'healthy';
      }
    }
  }

  _recordOk(ep, durMs) {
    ep.ok++; ep.consecutiveFail = 0;
    ep.lastMs = durMs;
    ep.emaMs = ep.emaMs == null ? durMs : (ep.emaMs * 0.7 + durMs * 0.3);
    ep.state = 'healthy'; ep.lastError = null;
    this._notify();
  }

  _recordFail(ep, err) {
    ep.fail++; ep.consecutiveFail++;
    ep.lastError = (err?.shortMessage || err?.message || String(err)).slice(0, 240);
    ep.lastErrorAt = Date.now();
    if (ep.consecutiveFail >= CONSECUTIVE_FAIL_BAN) {
      ep.state = 'banned'; ep.bannedUntil = Date.now() + BAN_COOLDOWN_MS;
      log.warn('rpc', `endpoint banned for ${BAN_COOLDOWN_MS}ms`, {
        url: ep.url, consecutiveFail: ep.consecutiveFail, lastError: ep.lastError,
      });
    } else {
      ep.state = 'cooling';
    }
    this._notify();
  }

  // -- Ordering -------------------------------------------------------------

  _order() {
    // Order: state asc (healthy first), then inFlight asc (spread parallel
    // load), then private endpoints, then EMA latency, then success count.
    // Skips `disabled` entirely.
    this._reviveBanned();
    const stateRank = { healthy: 0, cooling: 1, banned: 2 };
    return this.endpoints
      .filter((e) => e.state !== 'disabled')
      .sort((a, b) => {
        if (stateRank[a.state] !== stateRank[b.state]) return stateRank[a.state] - stateRank[b.state];
        if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
        const pa = a.isPrivate ? -1 : 0, pb = b.isPrivate ? -1 : 0;
        if (pa !== pb) return pa - pb;
        const la = a.emaMs ?? 9999, lb = b.emaMs ?? 9999;
        if (la !== lb) return la - lb;
        return b.ok - a.ok;
      });
  }

  // -- Core call helpers ----------------------------------------------------

  /** Run `fn(client)` on `ep`. Records health, classifies reverts. */
  async _callOn(ep, label, fn) {
    ep.inFlight++; this._notify();
    const t0 = performance.now();
    try {
      const result = await fn(ep.client);
      const dt = performance.now() - t0;
      this._recordOk(ep, dt);
      return result;
    } catch (err) {
      const dt = performance.now() - t0;
      if (isContractRevert(err)) { this._recordOk(ep, dt); throw err; }
      this._recordFail(ep, err);
      throw err;
    } finally {
      ep.inFlight = Math.max(0, ep.inFlight - 1);
      this._notify();
    }
  }

  /** Try `fn(client)` in health order until one transport-succeeds.
   *  Contract reverts re-throw immediately (endpoint counts as healthy). */
  async withClient(label, fn) {
    const order = this._order();
    const errors = [];
    for (const ep of order) {
      if (ep.state === 'banned') continue;
      try {
        const result = await this._callOn(ep, label, fn);
        log.debug('rpc', `${label} ok via ${shortUrl(ep.url)}`, { ms: +(ep.lastMs ?? 0).toFixed(1) });
        return result;
      } catch (err) {
        if (isContractRevert(err)) throw err; // already re-thrown by _callOn
        log.warn('rpc', `${label} network failure via ${shortUrl(ep.url)} → trying next`, {
          ms: +(ep.lastMs ?? 0).toFixed(1), error: ep.lastError,
        });
        errors.push({ url: ep.url, error: ep.lastError });
      }
    }
    log.error('rpc', `${label} exhausted all endpoints`, { tried: errors.length, errors });
    const agg = new Error(`RPC aggregator: all ${errors.length} endpoints failed for ${label}`);
    agg.errors = errors;
    throw agg;
  }

  /** Quorum read: fire fn at k endpoints in parallel, require unanimous
   *  agreement. Disagreement triggers a tiebreaker. Defends against a
   *  single malicious public RPC forging results. */
  async withQuorum(label, fn, { k = 2, equal = sameJson } = {}) {
    const usable = this._order().filter((e) => e.state !== 'banned');
    if (usable.length < k) {
      log.warn('rpc', `${label}: only ${usable.length} usable endpoints, falling back to single-source`);
      return this.withClient(label, fn);
    }
    const seeds = usable.slice(0, k);
    const seedResults = await Promise.allSettled(seeds.map((ep) => this._callOn(ep, label, fn)));
    const successes = seedResults.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (successes.length === 0) {
      log.warn('rpc', `${label}: all ${k} quorum seeds errored, falling back`);
      return this.withClient(label, fn);
    }
    if (successes.length === 1) {
      log.warn('rpc', `${label}: only 1 of ${k} seeds returned — accepting single answer (degraded)`);
      return successes[0];
    }
    const allAgree = successes.every((r) => equal(r, successes[0]));
    if (allAgree) {
      log.debug('rpc', `${label}: ${successes.length}-of-${k} quorum agree`);
      return successes[0];
    }
    const tiebreaker = usable.find((e) => !seeds.includes(e));
    if (!tiebreaker) {
      log.error('rpc', `${label}: quorum DISAGREES and no tiebreaker available — returning first answer (degraded)`, {
        seeds: seeds.map((s) => s.url),
      });
      return successes[0];
    }
    log.warn('rpc', `${label}: quorum disagreement, firing tiebreaker via ${shortUrl(tiebreaker.url)}`);
    let tieResult;
    try { tieResult = await this._callOn(tiebreaker, label, fn); }
    catch (e) {
      log.error('rpc', `${label}: tiebreaker errored, returning first seed (degraded)`, { msg: e?.message });
      return successes[0];
    }
    const match = successes.find((r) => equal(r, tieResult));
    if (match) return match;
    log.error('rpc', `${label}: tiebreaker disagreed with ALL seeds — likely one endpoint is lying. Returning tiebreaker.`, {
      seeds: seeds.map((s) => s.url), tiebreaker: tiebreaker.url,
    });
    return tieResult;
  }

  // -- Pre-flight -----------------------------------------------------------

  /** Probe every endpoint once. CORS-failing endpoints get permanently
   *  disabled; the rest get a head start on health stats. */
  async preflight({ timeoutMs = 4000 } = {}) {
    const endDone = log.time('rpc', `pre-flight ${this.endpoints.length} endpoints`);
    const results = await Promise.all(this.endpoints.map(async (ep) => {
      const t0 = performance.now();
      try {
        const blk = await Promise.race([
          ep.client.getBlockNumber(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('preflight timeout')), timeoutMs)),
        ]);
        const dt = performance.now() - t0;
        this._recordOk(ep, dt);
        return { url: ep.url, ok: true, ms: +dt.toFixed(0), head: blk?.toString() };
      } catch (err) {
        const dt = performance.now() - t0;
        if (looksLikeCors(err)) {
          ep.state = 'disabled';
          ep.lastError = (err.shortMessage || err.message || String(err)).slice(0, 240);
          ep.lastErrorAt = Date.now();
          this._notify();
          return { url: ep.url, ok: false, disabled: true, ms: +dt.toFixed(0), reason: ep.lastError };
        }
        this._recordFail(ep, err);
        return { url: ep.url, ok: false, disabled: false, ms: +dt.toFixed(0), reason: ep.lastError };
      }
    }));
    const ok = results.filter((r) => r.ok).length;
    const disabled = results.filter((r) => r.disabled).length;
    endDone({ ok, disabled, failed: results.length - ok - disabled });
    log.info('rpc', `pre-flight: ${ok} usable / ${disabled} CORS-disabled / ${results.length - ok - disabled} transient-fail`, {
      disabled: results.filter((r) => r.disabled).map((r) => r.url),
    });
    return results;
  }
}
