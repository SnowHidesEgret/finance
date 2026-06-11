/**
 * @fileoverview GET /api/stock/finnhub?type=<type>&symbol=<symbol>
 *
 * Unified Finnhub API proxy with D1 caching layer.
 * Supported types: news, recommendation, price-target, basic-financials, earnings
 */

/** Cache TTL per data type (seconds) */
const CACHE_TTL = {
  'basic-financials': 24 * 3600, // 24 hours
  'earnings': 12 * 3600,         // 12 hours
};

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

/**
 * Build the Finnhub API URL for a given type and symbol.
 */
function buildFinnhubUrl(type, symbol, apiKey) {
  const today = new Date();
  const fmt = (d) => d.toISOString().split('T')[0];

  switch (type) {
    case 'basic-financials':
      return `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`;
    case 'earnings': {
      const from = new Date(today);
      from.setDate(from.getDate() - 7);
      const to = new Date(today);
      to.setDate(to.getDate() + 14);
      return `${FINNHUB_BASE}/calendar/earnings?from=${fmt(from)}&to=${fmt(to)}&symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    }
    default:
      return null;
  }
}

/**
 * GET handler — proxy Finnhub API with D1 caching.
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const type = (url.searchParams.get('type') ?? '').trim().toLowerCase();
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();

  if (!type || !symbol) {
    return Response.json(
      { success: false, error: 'Missing required parameters: type, symbol' },
      { status: 400 },
    );
  }

  if (!CACHE_TTL[type]) {
    return Response.json(
      { success: false, error: `Unsupported type: ${type}. Supported: ${Object.keys(CACHE_TTL).join(', ')}` },
      { status: 400 },
    );
  }

  const db = env.DB;

  // ── 1. Read Finnhub API key from user_settings ─────────────
  const keyRow = await db
    .prepare("SELECT value FROM user_settings WHERE key = 'finnhub_api_key'")
    .first();
  const apiKey = keyRow ? keyRow.value : '';

  if (!apiKey) {
    return Response.json(
      { success: false, error: 'no_api_key', message: 'Finnhub API Key 未配置。请前往 设置 页面进行配置。' },
      { status: 200 },
    );
  }

  const cacheKey = `${type}:${symbol}`;
  const ttlSeconds = CACHE_TTL[type];

  // ── 2. Check D1 cache ──────────────────────────────────────
  try {
    const cached = await db
      .prepare(
        `SELECT data, (strftime('%s','now') - strftime('%s', updated_at)) AS age_seconds
         FROM finnhub_cache WHERE cache_key = ?1`,
      )
      .bind(cacheKey)
      .first();

    if (cached && cached.age_seconds < ttlSeconds) {
      return Response.json({
        success: true,
        data: JSON.parse(cached.data),
        cached: true,
        cacheAge: cached.age_seconds,
      });
    }
  } catch (e) {
    console.warn(`[Finnhub] Cache read error for ${cacheKey}:`, e.message);
  }

  // ── 3. Fetch from Finnhub API ──────────────────────────────
  const finnhubUrl = buildFinnhubUrl(type, symbol, apiKey);
  if (!finnhubUrl) {
    return Response.json(
      { success: false, error: `Failed to build URL for type: ${type}` },
      { status: 400 },
    );
  }

  let finnhubData = null;

  try {
    const resp = await fetch(finnhubUrl, {
      headers: { 'X-Finnhub-Token': apiKey },
    });

    if (resp.status === 429) {
      console.warn(`[Finnhub] Rate limited for ${cacheKey}`);
      // Try to return stale cache
      return await returnStaleOrError(db, cacheKey, 'Finnhub API 频率限制，请稍后重试。');
    }

    if (!resp.ok) {
      console.warn(`[Finnhub] HTTP ${resp.status} for ${cacheKey}`);
      return await returnStaleOrError(db, cacheKey, `Finnhub API 返回 HTTP ${resp.status}`);
    }

    finnhubData = await resp.json();

    // Normalize earnings calendar response
    if (type === 'earnings' && finnhubData?.earningsCalendar) {
      finnhubData = finnhubData.earningsCalendar;
    }

  } catch (e) {
    console.error(`[Finnhub] Fetch error for ${cacheKey}:`, e.message);
    return await returnStaleOrError(db, cacheKey, `Finnhub 请求失败: ${e.message}`);
  }

  // ── 4. Write to D1 cache ───────────────────────────────────
  try {
    const jsonStr = JSON.stringify(finnhubData);
    await db
      .prepare(
        `INSERT INTO finnhub_cache (cache_key, data, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(cache_key) DO UPDATE SET
           data = excluded.data,
           updated_at = datetime('now')`,
      )
      .bind(cacheKey, jsonStr)
      .run();
  } catch (e) {
    console.warn(`[Finnhub] Cache write error for ${cacheKey}:`, e.message);
    // Non-fatal — still return data
  }

  return Response.json({
    success: true,
    data: finnhubData,
    cached: false,
  });
}

/**
 * Helper: return stale cache or error response.
 */
async function returnStaleOrError(db, cacheKey, errorMessage) {
  try {
    const stale = await db
      .prepare('SELECT data FROM finnhub_cache WHERE cache_key = ?1')
      .bind(cacheKey)
      .first();

    if (stale) {
      return Response.json({
        success: true,
        data: JSON.parse(stale.data),
        cached: true,
        stale: true,
      });
    }
  } catch (_) { /* ignore */ }

  return Response.json(
    { success: false, error: errorMessage },
    { status: 200 },
  );
}
