/**
 * @fileoverview GET /api/agent/portfolio — Portfolio overview summary.
 *
 * Route:
 *   GET /api/agent/portfolio
 *
 * READ-ONLY: uses cached quotes & rates. Does not fetch live quotes from Yahoo or write snapshots.
 *
 * Fixes addressed:
 *   - B1: Unified error format code/message via errorResponse
 *   - B9: No quotes returns lastUpdated: null (do not fall back to now); adds oldestQuoteAt
 *   - Q2: Cost converted using live exchange rate (consistent with Dashboard)
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

export async function onRequestGet({ env }) {
  const db = env?.DB;
  if (!db) {
    return errorResponse('DB_UNAVAILABLE', '数据库连接不可用', 500);
  }

  try {
    // 1. Fetch all OPEN positions
    const { results: positions } = await db.prepare(
      "SELECT * FROM positions WHERE status = 'OPEN'"
    ).all();

    // 2. Fetch cached quotes, exchange rates, and latest ALL snapshot in parallel
    const [quoteMap, rates, snapshot] = await Promise.all([
      loadQuoteMap(db),
      loadRates(db),
      db.prepare(
        "SELECT ytd_pnl_cny FROM portfolio_snapshots WHERE market = 'ALL' ORDER BY snapshot_date DESC LIMIT 1"
      ).first(),
    ]);

    let totalValueCNY = 0;
    let totalCostCNY = 0;

    /** @type {Record<string, { count: number, valueCNY: number, pnlCNY: number }>} */
    const markets = {};

    let latestQuoteTime = null;
    let oldestQuoteTime = null;

    for (const pos of positions ?? []) {
      const currency = marketCurrency(pos.market);
      const rateToCNY = getRateToCNY(currency, rates);

      // Q2: Cost in CNY using live exchange rate
      const costOriginal = (pos.open_price * pos.quantity) + (pos.commission || 0);
      const costCNY = round2(costOriginal * rateToCNY);

      // Value in CNY: use cached quote price, fall back to open price
      const quote = quoteMap.get(pos.symbol?.toUpperCase());
      const currentPrice = (quote && quote.price != null) ? Number(quote.price) : pos.open_price;
      const valueCNY = round2(pos.quantity * currentPrice * rateToCNY);

      totalCostCNY += costCNY;
      totalValueCNY += valueCNY;

      const mkt = pos.market || 'OTHER';
      if (!markets[mkt]) {
        markets[mkt] = { count: 0, valueCNY: 0, pnlCNY: 0 };
      }
      markets[mkt].count += 1;
      markets[mkt].valueCNY += valueCNY;
      markets[mkt].pnlCNY += (valueCNY - costCNY);

      // Track quote timestamps for B9
      if (quote?.updatedAt) {
        const isoTs = formatIsoUtc(quote.updatedAt);
        if (isoTs) {
          if (!latestQuoteTime || isoTs > latestQuoteTime) {
            latestQuoteTime = isoTs;
          }
          if (!oldestQuoteTime || isoTs < oldestQuoteTime) {
            oldestQuoteTime = isoTs;
          }
        }
      }
    }

    const roundedTotalValueCNY = round2(totalValueCNY);
    const roundedTotalCostCNY = round2(totalCostCNY);
    const roundedTotalPnlCNY = round2(roundedTotalValueCNY - roundedTotalCostCNY);
    const totalPnlPercent = roundedTotalCostCNY > 0
      ? round2((roundedTotalPnlCNY / roundedTotalCostCNY) * 100)
      : 0;

    for (const key of Object.keys(markets)) {
      markets[key].valueCNY = round2(markets[key].valueCNY);
      markets[key].pnlCNY = round2(markets[key].pnlCNY);
    }

    const ytdPnlCNY = (snapshot && snapshot.ytd_pnl_cny != null)
      ? round2(Number(snapshot.ytd_pnl_cny))
      : null;

    return successResponse({
      totalValueCNY: roundedTotalValueCNY,
      totalCostCNY: roundedTotalCostCNY,
      totalPnlCNY: roundedTotalPnlCNY,
      totalPnlPercent,
      ytdPnlCNY,
      positionCount: (positions ?? []).length,
      markets,
      lastUpdated: latestQuoteTime || null,
      oldestQuoteAt: oldestQuoteTime || null,
    });
  } catch (err) {
    console.error('[agent:portfolio]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取组合概要', 500);
  }
}
