/**
 * @fileoverview GET /api/agent/position/:symbol — Detail and trade history for a single position.
 *
 * Route:
 *   GET /api/agent/position/:symbol
 *   GET /api/agent/position/:symbol?status=OPEN
 *
 * Fixes addressed:
 *   - B2: Prefer status='OPEN' first, then latest by open_date DESC; associate trades by position_id (not symbol); support optional ?status=
 *   - B4: Trades order by trade_date ASC, created_at ASC, id ASC; trades include id, positionId
 *   - Q2: Open cost uses live exchange rate for OPEN positions
 *   - Q3: Currency derived from market via marketCurrency(pos.market)
 *   - Q4: Hint suggests alternative symbol format if not found
 */

import {
  round2,
  marketCurrency,
  getRateToCNY,
  loadRates,
  successResponse,
  errorResponse,
} from '../../../../lib/agent-common.js';

const VALID_STATUSES = new Set(['OPEN', 'CLOSED']);

/**
 * Generate alternative symbol format for hint (Q4).
 * @param {string} sym
 * @returns {string|null}
 */
function getAlternativeSymbol(sym) {
  if (!sym) return null;
  const s = sym.toUpperCase();
  if (s.endsWith('.SHH')) return s.replace(/\.SHH$/, '.SS');
  if (s.endsWith('.SS')) return s.replace(/\.SS$/, '.SHH');
  if (s.endsWith('.SHZ')) return s.replace(/\.SHZ$/, '.SZ');
  if (s.endsWith('.SZ')) return s.replace(/\.SZ$/, '.SHZ');
  if (s.endsWith('.HKG')) return s.replace(/\.HKG$/, '.HK');
  if (s.endsWith('.HK')) return s.replace(/\.HK$/, '.HKG');
  if (s.endsWith('.SWX')) return s.replace(/\.SWX$/, '.SW');
  if (s.endsWith('.SW')) return s.replace(/\.SW$/, '.SWX');
  if (s.endsWith('.SH')) return s.replace(/\.SH$/, '.SS');
  return null;
}

export async function onRequestGet({ env, params, request }) {
  const db = env?.DB;
  if (!db) {
    return errorResponse('DB_UNAVAILABLE', '数据库连接不可用', 500);
  }

  const rawSymbol = params.symbol || '';
  const symbol = rawSymbol.trim().toUpperCase();

  if (!symbol) {
    return errorResponse('SYMBOL_REQUIRED', '缺少股票代码参数', 400);
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get('status');
  let statusFilter = null;
  if (rawStatus) {
    statusFilter = rawStatus.trim().toUpperCase();
    if (!VALID_STATUSES.has(statusFilter)) {
      return errorResponse(
        'INVALID_STATUS',
        `无效的状态参数: ${rawStatus}，合法值为: OPEN, CLOSED`,
        400,
        { hint: '支持的状态: OPEN, CLOSED' }
      );
    }
  }

  try {
    // B2: Lookup position. If ?status= is provided, filter by it.
    // Otherwise try status='OPEN' first; if not found, order by open_date DESC.
    let pos = null;
    if (statusFilter) {
      pos = await db.prepare(
        'SELECT * FROM positions WHERE symbol = ?1 COLLATE NOCASE AND status = ?2 ORDER BY open_date DESC LIMIT 1'
      ).bind(symbol, statusFilter).first();
    } else {
      pos = await db.prepare(
        "SELECT * FROM positions WHERE symbol = ?1 COLLATE NOCASE AND status = 'OPEN' ORDER BY open_date DESC LIMIT 1"
      ).bind(symbol).first();

      if (!pos) {
        pos = await db.prepare(
          'SELECT * FROM positions WHERE symbol = ?1 COLLATE NOCASE ORDER BY open_date DESC LIMIT 1'
        ).bind(symbol).first();
      }
    }

    if (!pos) {
      const alt = getAlternativeSymbol(symbol);
      const hint = alt
        ? `该代码可能以另一种格式存储，可尝试查询 ${alt}，或通过 GET /api/agent/positions 查看全部持仓代码`
        : '未找到对应持仓，请检查股票代码拼写，或通过 GET /api/agent/positions 查看全部持仓代码';
      return errorResponse('POSITION_NOT_FOUND', `未找到持仓: ${symbol}`, 404, { hint });
    }

    // B2: Associated trades query by position_id (not symbol)
    const [quote, tradesResult, rates] = await Promise.all([
      db.prepare('SELECT * FROM quote_cache WHERE symbol = ?1 COLLATE NOCASE').bind(pos.symbol).first(),
      db.prepare(
        'SELECT * FROM trades WHERE position_id = ?1 ORDER BY trade_date ASC, created_at ASC, id ASC'
      ).bind(pos.id).all(),
      loadRates(db),
    ]);

    const currency = marketCurrency(pos.market);
    const rateToCNY = getRateToCNY(currency, rates);

    let currentPrice = null;
    let costCNY = 0;
    let valueCNY = 0;
    let pnlCNY = 0;
    let pnlPercent = 0;
    let closeDate = null;
    let closePrice = null;

    if (pos.status === 'CLOSED') {
      closePrice = pos.close_price != null ? Number(pos.close_price) : pos.open_price;
      const closeRate = pos.close_rate_to_cny != null ? Number(pos.close_rate_to_cny) : rateToCNY;
      const costRate = pos.open_rate_to_cny || closeRate;

      costCNY = round2((pos.quantity * pos.open_price + (pos.commission || 0)) * costRate);
      valueCNY = round2(pos.quantity * closePrice * closeRate);
      pnlCNY = round2(valueCNY - costCNY - ((pos.close_commission || 0) * closeRate));
      pnlPercent = costCNY > 0 ? round2((pnlCNY / costCNY) * 100) : 0;
      closeDate = pos.close_date || null;
    } else {
      const hasQuote = quote && quote.price != null;
      currentPrice = hasQuote ? Number(quote.price) : null;

      // Q2: costCNY uses live exchange rate
      const costOriginal = (pos.open_price * pos.quantity) + (pos.commission || 0);
      costCNY = round2(costOriginal * rateToCNY);

      const activePrice = currentPrice !== null ? currentPrice : pos.open_price;
      valueCNY = round2(pos.quantity * activePrice * rateToCNY);
      pnlCNY = round2(valueCNY - costCNY);
      pnlPercent = costCNY > 0 ? round2((pnlCNY / costCNY) * 100) : 0;
    }

    // Format trades including id and positionId (B2, B4)
    const trades = (tradesResult.results ?? []).map((t) => ({
      id: t.id,
      positionId: t.position_id,
      type: t.trade_type,
      price: t.price,
      quantity: t.quantity,
      date: t.trade_date,
      tradeDate: t.trade_date,
      commission: t.commission,
      currency: t.currency,
      notes: t.notes || null,
      realizedPnl: t.realized_pnl != null ? t.realized_pnl : null,
      rateToCny: t.rate_to_cny != null ? t.rate_to_cny : null,
    }));

    return successResponse({
      id: pos.id,
      symbol: pos.symbol,
      name: pos.name,
      market: pos.market,
      currency,
      quantity: pos.quantity,
      openPrice: pos.open_price,
      openDate: pos.open_date,
      currentPrice,
      costCNY,
      valueCNY,
      pnlCNY,
      pnlPercent,
      sector: pos.sector || null,
      beta: pos.beta != null ? Number(pos.beta) : null,
      notes: pos.notes || null,
      status: pos.status,
      closeDate,
      closePrice: pos.close_price != null ? Number(pos.close_price) : null,
      trades,
    });
  } catch (err) {
    console.error('[agent:position]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取持仓详情', 500);
  }
}
