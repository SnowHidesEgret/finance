/**
 * @fileoverview GET /api/agent/positions?market=&status= — Position list with calculations.
 *
 * Route:
 *   GET /api/agent/positions
 *   GET /api/agent/positions?market=US&status=OPEN
 *
 * Fixes addressed:
 *   - B3: For status=CLOSED, calculate value and realized PnL using close_price and close_rate_to_cny
 *   - B9: When no quote cache exists, currentPrice: null and quoteUpdatedAt: null
 *   - Q2: Cost uses live exchange rate for OPEN positions
 *   - Q3: Currency derived from market via marketCurrency(pos.market)
 */

import {
  round2,
  marketCurrency,
  getRateToCNY,
  loadRates,
  loadQuoteMap,
  formatIsoUtc,
  successResponse,
  errorResponse,
} from '../../../lib/agent-common.js';

const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);
const VALID_STATUSES = new Set(['OPEN', 'CLOSED']);

export async function onRequestGet({ env, request }) {
  const db = env?.DB;
  if (!db) {
    return errorResponse('DB_UNAVAILABLE', '数据库连接不可用', 500);
  }

  const url = new URL(request.url);
  const rawMarket = url.searchParams.get('market');
  const rawStatus = url.searchParams.get('status');

  const market = rawMarket ? rawMarket.trim().toUpperCase() : null;
  const status = rawStatus ? rawStatus.trim().toUpperCase() : 'OPEN';

  if (market && !VALID_MARKETS.has(market)) {
    return errorResponse(
      'INVALID_MARKET',
      `无效的市场参数: ${rawMarket}，合法值为: ${[...VALID_MARKETS].join(', ')}`,
      400,
      { hint: '支持的市场: A_SHARE, HK, US, SWISS' }
    );
  }

  if (!VALID_STATUSES.has(status)) {
    return errorResponse(
      'INVALID_STATUS',
      `无效的状态参数: ${rawStatus}，合法值为: ${[...VALID_STATUSES].join(', ')}`,
      400,
      { hint: '支持的状态: OPEN, CLOSED' }
    );
  }

  try {
    let sql = 'SELECT * FROM positions WHERE status = ?1';
    const binds = [status];
    let paramIdx = 2;

    if (market) {
      sql += ` AND market = ?${paramIdx++}`;
      binds.push(market);
    }

    sql += ' ORDER BY open_date DESC';

    const { results: positions } = await db.prepare(sql).bind(...binds).all();

    const [quoteMap, rates] = await Promise.all([
      loadQuoteMap(db),
      loadRates(db),
    ]);

    const items = (positions ?? []).map((pos) => {
      const currency = marketCurrency(pos.market);
      const rateToCNY = getRateToCNY(currency, rates);

      if (pos.status === 'CLOSED') {
        // B3: CLOSED position uses close_price and close_rate_to_cny
        const closePrice = pos.close_price != null ? Number(pos.close_price) : pos.open_price;
        const closeRate = pos.close_rate_to_cny != null ? Number(pos.close_rate_to_cny) : rateToCNY;
        const costRate = pos.open_rate_to_cny || closeRate;

        const costCNY = round2((pos.quantity * pos.open_price + (pos.commission || 0)) * costRate);
        const valueCNY = round2(pos.quantity * closePrice * closeRate);
        const realizedPnlCNY = round2(valueCNY - costCNY - ((pos.close_commission || 0) * closeRate));
        const pnlPercent = costCNY > 0 ? round2((realizedPnlCNY / costCNY) * 100) : 0;

        return {
          id: pos.id,
          symbol: pos.symbol,
          name: pos.name,
          market: pos.market,
          currency,
          quantity: pos.quantity,
          openPrice: pos.open_price,
          currentPrice: null,
          costCNY,
          valueCNY,
          pnlCNY: realizedPnlCNY,
          pnlPercent,
          openDate: pos.open_date,
          status: pos.status,
          closeDate: pos.close_date || null,
          closePrice: pos.close_price != null ? Number(pos.close_price) : null,
          realizedPnlCNY,
          quoteUpdatedAt: null,
        };
      }

      // OPEN position
      const quote = quoteMap.get(pos.symbol?.toUpperCase());
      const hasQuote = quote && quote.price != null;
      const currentPrice = hasQuote ? Number(quote.price) : null;
      const quoteUpdatedAt = quote?.updatedAt ? formatIsoUtc(quote.updatedAt) : null;

      // Q2: costCNY uses live exchange rate
      const costOriginal = (pos.open_price * pos.quantity) + (pos.commission || 0);
      const costCNY = round2(costOriginal * rateToCNY);

      // B9: if currentPrice is null, value is estimated by openPrice
      const activePrice = currentPrice !== null ? currentPrice : pos.open_price;
      const valueCNY = round2(pos.quantity * activePrice * rateToCNY);
      const pnlCNY = round2(valueCNY - costCNY);
      const pnlPercent = costCNY > 0 ? round2((pnlCNY / costCNY) * 100) : 0;

      return {
        id: pos.id,
        symbol: pos.symbol,
        name: pos.name,
        market: pos.market,
        currency,
        quantity: pos.quantity,
        openPrice: pos.open_price,
        currentPrice,
        costCNY,
        valueCNY,
        pnlCNY,
        pnlPercent,
        openDate: pos.open_date,
        status: pos.status,
        closeDate: null,
        closePrice: null,
        realizedPnlCNY: null,
        quoteUpdatedAt,
      };
    });

    return successResponse({
      items,
      count: items.length,
      filter: { market: market || null, status },
    });
  } catch (err) {
    console.error('[agent:positions]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取持仓列表', 500);
  }
}
