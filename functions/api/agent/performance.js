/**
 * @fileoverview GET /api/agent/performance?market= — Portfolio and market performance metrics.
 *
 * Route:
 *   GET /api/agent/performance
 *   GET /api/agent/performance?market=US
 *
 * Features:
 *   - Shares pure computePortfolioPerformance logic with /api/summary
 *   - Strictly READ-ONLY: uses cached quotes & rates, does NOT write portfolio_snapshots
 *   - Returns dayPnlCNY, mtdPnlCNY, mtdPercent, ytdPnlCNY, ytdPercent, annualizedReturn, avgHoldingDays,
 *     totalValueCNY, totalCostCNY, totalPnlCNY, totalPnlPercent, positionCount, positions, markets
 *   - Supports optional market filtering (A_SHARE, HK, US, SWISS, ALL)
 */

import {
  computePortfolioPerformance,
  loadRates,
  loadQuoteMap,
  successResponse,
  errorResponse,
} from '../../../lib/agent-common.js';

const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS', 'ALL']);

export async function onRequestGet({ request, env }) {
  const db = env?.DB;
  if (!db) {
    return errorResponse('DB_UNAVAILABLE', '数据库连接不可用', 500);
  }

  const url = new URL(request.url);
  const rawMarket = url.searchParams.get('market');
  let targetMarket = null;

  if (rawMarket != null && rawMarket.trim() !== '') {
    targetMarket = rawMarket.trim().toUpperCase();
    if (!VALID_MARKETS.has(targetMarket)) {
      return errorResponse(
        'INVALID_MARKET',
        `无效的市场参数: ${rawMarket}，合法值为: A_SHARE, HK, US, SWISS, ALL`,
        400,
        { hint: '支持的市场: A_SHARE, HK, US, SWISS, ALL' }
      );
    }
  }

  try {
    const currentYearStr = new Date().getFullYear().toString();

    // 1. Fetch positions (OPEN + current year's CLOSED)
    const { results: positions } = await db.prepare(
      `SELECT * FROM positions 
       WHERE status = 'OPEN' 
          OR (status = 'CLOSED' AND close_date >= ?1)
       ORDER BY market, open_date DESC`
    ).bind(`${currentYearStr}-01-01`).all();

    // 2. Fetch trades for those positions with id fallback sorting (B4)
    const posList = positions ?? [];
    const posIds = posList.map(p => `'${p.id}'`).join(',');
    let allTrades = [];
    if (posIds) {
      const { results } = await db.prepare(
        `SELECT * FROM trades 
         WHERE position_id IN (${posIds}) 
         ORDER BY trade_date ASC, created_at ASC, id ASC`
      ).all();
      allTrades = results || [];
    }

    const tradesByPosition = {};
    for (const t of allTrades) {
      if (!tradesByPosition[t.position_id]) {
        tradesByPosition[t.position_id] = [];
      }
      tradesByPosition[t.position_id].push(t);
    }

    // 3. Load cached quotes and exchange rates in parallel
    const [quoteMap, rates] = await Promise.all([
      loadQuoteMap(db),
      loadRates(db),
    ]);

    // 4. Compute performance using the shared pure calculation function
    const performance = computePortfolioPerformance({
      positions: posList,
      tradesByPosition,
      quoteMap,
      rates,
      now: new Date(),
    });

    // 5. Structure output based on market filter
    const isSingleMarket = targetMarket && targetMarket !== 'ALL';

    // Map position details to clean agent response schema
    const formatPosition = (p) => ({
      id: p.id,
      symbol: p.symbol,
      name: p.name,
      market: p.market,
      currency: p.currency,
      quantity: p.quantity,
      openPrice: p.open_price,
      currentPrice: p.currentPrice,
      costCNY: p.costCNY,
      marketValueCNY: p.marketValueCNY,
      pnlCNY: p.pnlCNY,
      pnlPercent: p.pnlPercent,
      dayPnlCNY: p.dayPnLCNY,
      mtdPnlCNY: p.mtdPnLCNY,
      mtdPercent: p.mtdPercent,
      ytdPnlCNY: p.ytdPnLCNY,
      ytdPercent: p.ytdPercent,
      avgHoldingDays: p.avgHoldingDays,
      annualizedReturn: p.annualizedReturn,
      weightPercent: p.weight,
    });

    if (isSingleMarket) {
      const mktData = performance.markets[targetMarket] || {
        totalValueCNY: 0,
        totalCostCNY: 0,
        totalPnlCNY: 0,
        pnlPercent: 0,
        dayPnL: 0,
        ytdPnlCNY: 0,
        ytdPercent: 0,
        mtdPnlCNY: 0,
        mtdPercent: 0,
        avgHoldingDays: 1,
        annualizedReturn: 0,
        positionCount: 0,
      };

      const marketPositions = performance.positionDetails
        .filter(p => p.market === targetMarket)
        .map(formatPosition);

      return successResponse({
        market: targetMarket,
        totalValueCNY: mktData.totalValueCNY,
        totalCostCNY: mktData.totalCostCNY,
        totalPnlCNY: mktData.totalPnlCNY,
        totalPnlPercent: mktData.pnlPercent,
        dayPnlCNY: mktData.dayPnL,
        mtdPnlCNY: mktData.mtdPnlCNY,
        mtdPercent: mktData.mtdPercent,
        ytdPnlCNY: mktData.ytdPnlCNY,
        ytdPercent: mktData.ytdPercent,
        annualizedReturn: mktData.annualizedReturn,
        avgHoldingDays: mktData.avgHoldingDays,
        positionCount: mktData.positionCount,
        positions: marketPositions,
      }, { market: targetMarket });
    }

    const allPositions = performance.positionDetails.map(formatPosition);

    return successResponse({
      market: 'ALL',
      totalValueCNY: performance.totalValueCNY,
      totalCostCNY: performance.totalCostCNY,
      totalPnlCNY: performance.totalPnlCNY,
      totalPnlPercent: performance.totalPnlPercent,
      dayPnlCNY: performance.totalDayPnL,
      mtdPnlCNY: performance.portfolioMtdPnlCNY,
      mtdPercent: performance.totalMonthlyReturn,
      ytdPnlCNY: performance.portfolioYtdPnlCNY,
      ytdPercent: performance.portfolioYtdPercent,
      annualizedReturn: performance.totalAnnualizedReturn,
      avgHoldingDays: performance.totalAvgHoldingDays,
      positionCount: performance.positionDetails.length,
      markets: performance.markets,
      positions: allPositions,
    }, { market: 'ALL' });
  } catch (err) {
    console.error('[agent:performance]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法计算收益指标', 500);
  }
}
