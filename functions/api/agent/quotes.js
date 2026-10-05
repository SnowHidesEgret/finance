/**
 * @fileoverview GET /api/agent/quotes?symbols=A,B,C — Batch stock quotes.
 *
 * Route:
 *   GET /api/agent/quotes?symbols=AAPL,0700.HK,600036.SS
 *
 * Features:
 *   - Supports up to 20 comma-separated symbols
 *   - Checks D1 quote_cache first (5-minute TTL)
 *   - Concurrently fetches missing or stale quotes from Yahoo Finance
 *   - Writes freshly fetched quotes back to quote_cache
 *   - Returns items[] and errors[]
 */

import {
  round2,
  formatIsoUtc,
  successResponse,
  errorResponse,
} from '../../../lib/agent-common.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SYMBOLS = 20;

/**
 * Generate code format hint when a symbol cannot be found.
 * @param {string} sym
 * @returns {string}
 */
function getSymbolHint(sym) {
  if (sym.endsWith('.HKG')) return `可尝试使用 Yahoo 港股格式: ${sym.replace('.HKG', '.HK')}`;
  if (sym.endsWith('.SHH')) return `可尝试使用 Yahoo 上交所格式: ${sym.replace('.SHH', '.SS')}`;
  if (sym.endsWith('.SHZ')) return `可尝试使用 Yahoo 深交所格式: ${sym.replace('.SHZ', '.SZ')}`;
  if (sym.endsWith('.SWX')) return `可尝试使用 Yahoo 瑞士格式: ${sym.replace('.SWX', '.SW')}`;
  if (sym.endsWith('.SS')) return `如为深市股票请尝试 .SZ 后缀，或内部格式 ${sym.replace('.SS', '.SHH')}`;
  if (sym.endsWith('.SZ')) return `如为沪市股票请尝试 .SS 后缀，或内部格式 ${sym.replace('.SZ', '.SHZ')}`;
  if (sym.endsWith('.HK')) return `可尝试内部格式: ${sym.replace('.HK', '.HKG')}`;
  return '请检查代码拼写。美股无后缀（如 MSFT、AAPL），港股加 .HK（如 0700.HK），A股加 .SS（上交所）或 .SZ（深交所），瑞士加 .SW';
}

export async function onRequestGet({ request, env }) {
  const db = env?.DB;
  if (!db) {
    return errorResponse('DB_UNAVAILABLE', '数据库连接不可用', 500);
  }

  const url = new URL(request.url);
  const rawSymbols = url.searchParams.get('symbols');

  if (rawSymbols == null || rawSymbols.trim() === '') {
    return errorResponse(
      'MISSING_SYMBOLS',
      '缺少必需参数 symbols，请传入以逗号分隔的股票代码列表',
      400,
      { hint: '示例: /api/agent/quotes?symbols=AAPL,0700.HK,600036.SS' }
    );
  }

  const splitSymbols = rawSymbols
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  if (splitSymbols.length === 0) {
    return errorResponse('EMPTY_SYMBOLS', '股票代码列表不能为空', 400);
  }

  // Deduplicate while preserving order
  const symbolList = [...new Set(splitSymbols)];

  if (symbolList.length > MAX_SYMBOLS) {
    return errorResponse(
      'TOO_MANY_SYMBOLS',
      `一次最多查询 ${MAX_SYMBOLS} 个股票代码，当前传入 ${symbolList.length} 个`,
      400,
      { hint: `请将请求拆分为不超过 ${MAX_SYMBOLS} 个代码的批次` }
    );
  }

  try {
    // ── 1. Batch read from quote_cache ────────────────────────────────
    const placeholders = symbolList.map(() => '?').join(',');
    const { results: cachedRows } = await db.prepare(
      `SELECT * FROM quote_cache WHERE symbol IN (${placeholders})`
    ).bind(...symbolList).all();

    const cachedMap = new Map();
    for (const row of cachedRows ?? []) {
      cachedMap.set(row.symbol.toUpperCase(), row);
    }

    const items = [];
    const errors = [];
    const needFetch = [];

    const now = Date.now();
    for (const sym of symbolList) {
      const cached = cachedMap.get(sym);
      if (cached && cached.updated_at) {
        const age = now - new Date(cached.updated_at).getTime();
        if (age < CACHE_TTL_MS) {
          const price = Number(cached.price);
          const prevClose = cached.prev_close != null ? Number(cached.prev_close) : null;
          let change = cached.change_amount != null
            ? Number(cached.change_amount)
            : (prevClose != null ? price - prevClose : 0);
          let changePercent = cached.change_percent != null
            ? Number(cached.change_percent)
            : (prevClose ? (change / prevClose) * 100 : 0);

          items.push({
            symbol: sym,
            price,
            previousClose: prevClose,
            change: round2(change),
            changePercent: round2(changePercent),
            currency: cached.currency,
            cached: true,
            updatedAt: formatIsoUtc(cached.updated_at),
          });
          continue;
        }
      }
      needFetch.push(sym);
    }

    // ── 2. Concurrently fetch missing/stale quotes from Yahoo ─────────
    if (needFetch.length > 0) {
      const fetchResults = await Promise.allSettled(
        needFetch.map(async (sym) => {
          const yahooURL = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?region=US&lang=en-US&includePrePost=false&interval=1d&range=1d`;
          const res = await fetch(yahooURL, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json',
            },
          });

          if (!res.ok) {
            if (res.status === 404 || res.status === 422) {
              return { success: false, notFound: true, symbol: sym };
            }
            return { success: false, notFound: false, status: res.status, symbol: sym };
          }

          const data = await res.json();
          const result = data?.chart?.result?.[0];
          if (!result || !result.meta || result.meta.regularMarketPrice == null) {
            return { success: false, notFound: true, symbol: sym };
          }

          const meta = result.meta;
          const price = Number(meta.regularMarketPrice);
          const previousClose = meta.chartPreviousClose != null
            ? Number(meta.chartPreviousClose)
            : (meta.previousClose != null ? Number(meta.previousClose) : price);
          const currency = meta.currency || '';
          const change = price - previousClose;
          const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;

          return {
            success: true,
            symbol: sym,
            price,
            previousClose,
            change: round2(change),
            changePercent: round2(changePercent),
            currency,
          };
        })
      );

      const upsertStmts = [];
      const fetchNow = new Date().toISOString();

      for (let i = 0; i < needFetch.length; i++) {
        const sym = needFetch[i];
        const res = fetchResults[i];

        if (res.status === 'fulfilled' && res.value?.success) {
          const q = res.value;
          items.push({
            symbol: q.symbol,
            price: q.price,
            previousClose: q.previousClose,
            change: q.change,
            changePercent: q.changePercent,
            currency: q.currency,
            cached: false,
            updatedAt: fetchNow,
          });

          upsertStmts.push(
            db.prepare(`
              INSERT INTO quote_cache (symbol, price, change_amount, change_percent, prev_close, currency, updated_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
              ON CONFLICT(symbol) DO UPDATE SET
                price          = excluded.price,
                change_amount  = excluded.change_amount,
                change_percent = excluded.change_percent,
                prev_close     = excluded.prev_close,
                currency       = excluded.currency,
                updated_at     = excluded.updated_at
            `).bind(q.symbol, q.price, q.change, q.changePercent, q.previousClose, q.currency, fetchNow)
          );
        } else {
          const val = res.status === 'fulfilled' ? res.value : null;
          if (val?.notFound) {
            errors.push({
              symbol: sym,
              code: 'SYMBOL_NOT_FOUND',
              message: `未找到股票代码行情: ${sym}`,
              hint: getSymbolHint(sym),
            });
          } else {
            errors.push({
              symbol: sym,
              code: 'UPSTREAM_QUOTE_FAILED',
              message: `上游行情服务获取失败: ${sym}${val?.status ? ` (HTTP ${val.status})` : ''}`,
              hint: '可稍后重试',
            });
          }
        }
      }

      // ── 3. Upsert fresh quotes to cache ─────────────────────────────
      if (upsertStmts.length > 0) {
        try {
          await db.batch(upsertStmts);
        } catch (cacheErr) {
          console.warn('[agent:quotes] Failed to update quote_cache:', cacheErr.message);
        }
      }
    }

    // Sort items to match requested symbol order
    const symbolOrderMap = new Map(symbolList.map((sym, idx) => [sym, idx]));
    items.sort((a, b) => (symbolOrderMap.get(a.symbol) ?? 0) - (symbolOrderMap.get(b.symbol) ?? 0));

    return successResponse({
      items,
      errors,
      count: items.length,
    });
  } catch (err) {
    console.error('[agent:quotes]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取行情', 500);
  }
}
