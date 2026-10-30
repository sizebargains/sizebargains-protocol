// Market feed. Follows the "market" register record only; contract state never reaches this file.
export const POLL_MS = 60000;
export const BACKOFF = { base: 2000, max: 60000 };
export const TIMEOUT_MS = 12000;
export const LIMIT = 10;
export const CHUNK = 30;

export function backoffDelay(failures, rnd = Math.random) {
  const raw = Math.min(BACKOFF.max, BACKOFF.base * 2 ** Math.max(0, failures - 1));
  return Math.round(raw * (0.85 + 0.3 * rnd()));
}

export function solanaAddresses(boosts) {
  if (!Array.isArray(boosts)) throw new Error('boosts: unexpected shape');
  const seen = new Set();
  for (const b of boosts) if (b && b.chainId === 'solana' && typeof b.tokenAddress === 'string') seen.add(b.tokenAddress);
  return [...seen];
}

export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

// one row per base token: the deepest pair wins
export function toRows(pairs, wanted, limit = LIMIT) {
  const want = new Set(wanted);
  const best = new Map();
  for (const p of pairs) {
    const addr = p && p.baseToken && p.baseToken.address;
    if (!addr || !want.has(addr) || p.chainId !== 'solana') continue;
    const liq = Number(p.liquidity && p.liquidity.usd) || 0;
    const cur = best.get(addr);
    if (!cur || liq > cur.liquidity) {
      best.set(addr, {
        address: addr,
        symbol: String(p.baseToken.symbol || '?'),
        name: String(p.baseToken.name || p.baseToken.symbol || ''),
        imageUrl: (p.info && p.info.imageUrl) || '',
        price: Number(p.priceUsd),
        priceNative: Number(p.priceNative),
        quote: String((p.quoteToken && p.quoteToken.symbol) || ''),
        change: Number(p.priceChange && p.priceChange.h24),
        volume: Number(p.volume && p.volume.h24) || 0,
        liquidity: liq,
      });
    }
  }
  return [...best.values()].sort((a, b) => b.volume - a.volume).slice(0, limit);
}

export function sortRows(rows, key) {
  const k = { vol: 'volume', chg: 'change', liq: 'liquidity' }[key] || 'volume';
  return [...rows].sort((a, b) => (Number.isFinite(b[k]) ? b[k] : -Infinity) - (Number.isFinite(a[k]) ? a[k] : -Infinity));
}

async function getJson(url, fetchFn, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchFn(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export async function loadRows(cfg, fetchFn = fetch, signal) {
  const boosts = await getJson(cfg.boosts, fetchFn, signal);
  const addrs = solanaAddresses(boosts);
  if (!addrs.length) throw new Error('no solana entries');
  const parts = await Promise.all(chunk(addrs, CHUNK).map((c) => getJson(cfg.pairs + c.join(','), fetchFn, signal)));
  const pairs = parts.flatMap((p) => (Array.isArray(p) ? p : []));
  const rows = toRows(pairs, addrs);
  if (!rows.length) throw new Error('no pairs');
  return rows;
}

// Poll loop: 60s cadence, exponential backoff on failure, paused while hidden, immediate fetch on show.
export function createFeed(cfg, hooks, env = {}) {
  const doc = env.doc || document;
  const fetchFn = env.fetch || ((...a) => fetch(...a));
  const setT = env.setTimeout || setTimeout;
  const clearT = env.clearTimeout || clearTimeout;
  let timer = null, failures = 0, inflight = null, started = false;

  const schedule = (ms) => { clearT(timer); timer = setT(refresh, ms); };

  async function refresh() {
    clearT(timer); timer = null;
    if (doc.hidden || inflight) return;
    const ctl = new AbortController();
    inflight = ctl;
    try {
      const rows = await loadRows(cfg, fetchFn, ctl.signal);
      if (inflight !== ctl) return;
      failures = 0;
      hooks.onData(rows);
    } catch (err) {
      if (inflight !== ctl) return;
      failures += 1;
      hooks.onError(err, failures);
    } finally {
      if (inflight === ctl) inflight = null;
    }
    if (!doc.hidden) schedule(failures ? backoffDelay(failures) : POLL_MS);
  }

  function onVis() {
    if (doc.hidden) {
      clearT(timer); timer = null;
      if (inflight) { inflight.abort(); inflight = null; }
    } else if (started) {
      refresh();
    }
  }

  return {
    start() { started = true; doc.addEventListener('visibilitychange', onVis); refresh(); },
    stop() { started = false; clearT(timer); doc.removeEventListener('visibilitychange', onVis); if (inflight) inflight.abort(); },
    get failures() { return failures; },
  };
}
