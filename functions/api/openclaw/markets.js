/**
 * OpenClaw API — Markets Endpoint
 * GET /api/openclaw/markets
 *
 * Returns per-market portfolio summaries:
 *   positionCount, totalValueCNY, totalCostCNY, totalPnlCNY, pnlPercent, ytdPnlCNY
 *
 * Calculation approach:
 *   1. Fetch all OPEN positions joined with latest quote_cache prices
 *   2. Fetch exchange rates (with hardcoded fallbacks)
 *   3. Aggregate per market
 *   4. Enrich with YTD P&L from the latest portfolio_snapshots
 */

// Market → currency mapping
const MARKET_CURRENCY = {
  A_SHARE: 'CNY',
  HK: 'HKD',
  US: 'USD',
  SWISS: 'CHF',
};

// Fallback rates: 1 foreign unit = X CNY
const FALLBACK_RATES = {
  USD: 7.2,
  HKD: 0.9231,
  CHF: 8.1,
  CNY: 1,
};

export async function onRequestGet(context) {
  const { env } = context;

  try {
    // ── 1. Positions + current prices ────────────────────────────
    const positionsSQL = `
      SELECT
        p.id, p.symbol, p.market, p.currency,
        p.open_price, p.open_rate_to_cny, p.quantity, p.commission,
        q.price AS current_price
      FROM positions p
      LEFT JOIN quote_cache q ON p.symbol = q.symbol
      WHERE p.status = 'OPEN'
    `;

    // ── 2. Exchange rates ────────────────────────────────────────
    const ratesSQL = `
      SELECT base_currency, target_currency, rate
      FROM exchange_rates
    `;

    // ── 3. Latest per-market snapshots (for YTD) ─────────────────
    const snapshotsSQL = `
      SELECT market, ytd_pnl_cny
      FROM portfolio_snapshots
      WHERE (market, snapshot_date) IN (
        SELECT market, MAX(snapshot_date)
        FROM portfolio_snapshots
        GROUP BY market
      )
    `;

    const [posResult, ratesResult, snapResult] = await Promise.all([
      env.DB.prepare(positionsSQL).all(),
      env.DB.prepare(ratesSQL).all(),
      env.DB.prepare(snapshotsSQL).all(),
    ]);

    // ── Build rate lookup (currency → CNY) ───────────────────────
    const rateToCNY = { ...FALLBACK_RATES };
    let dbHasRates = false;
    for (const row of ratesResult.results || []) {
      const rate = Number(row.rate);
      if (!rate) continue;
      if (row.target_currency === 'CNY') {
        rateToCNY[row.base_currency] = rate < 1 && row.base_currency !== 'HKD' ? 1 / rate : rate;
        dbHasRates = true;
      } else if (row.base_currency === 'CNY') {
        rateToCNY[row.target_currency] = 1 / rate;
        dbHasRates = true;
      }
    }

    if (!dbHasRates) {
      try {
        const rateRes = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD,CHF');
        if (rateRes.ok) {
          const rateData = await rateRes.json();
          if (rateData.rates) {
            if (rateData.rates.USD) rateToCNY.USD = 1 / rateData.rates.USD;
            if (rateData.rates.HKD) rateToCNY.HKD = 1 / rateData.rates.HKD;
            if (rateData.rates.CHF) rateToCNY.CHF = 1 / rateData.rates.CHF;
          }
        }
      } catch (e) {
        console.warn('OpenClaw live rate fetch failed, using fallback:', e.message);
      }
    }

    // ── Build YTD lookup ─────────────────────────────────────────
    const ytdByMarket = {};
    for (const row of snapResult.results || []) {
      ytdByMarket[row.market] = row.ytd_pnl_cny ?? 0;
    }

    // ── Aggregate by market ──────────────────────────────────────
    const marketData = {};

    for (const pos of posResult.results || []) {
      const market = pos.market;
      if (!marketData[market]) {
        marketData[market] = {
          positionCount: 0,
          totalValueCNY: 0,
          totalCostCNY: 0,
          totalPnlCNY: 0,
          pnlPercent: 0,
          ytdPnlCNY: 0,
        };
      }

      const entry = marketData[market];
      const currency = pos.currency || MARKET_CURRENCY[market] || 'CNY';
      const rate = rateToCNY[currency] ?? 1;

      // Cost in CNY: use the stored open_rate_to_cny if available
      const costRate = pos.open_rate_to_cny || rate;
      const costCNY = pos.open_price * pos.quantity * costRate + (pos.commission || 0) * costRate;

      // Current value in CNY (use current_price from quote_cache, fall back to open_price)
      const currentPrice = pos.current_price ?? pos.open_price;
      const valueCNY = currentPrice * pos.quantity * rate;

      entry.positionCount += 1;
      entry.totalCostCNY += costCNY;
      entry.totalValueCNY += valueCNY;
    }

    // ── Finalize percentages & YTD ───────────────────────────────
    for (const [market, entry] of Object.entries(marketData)) {
      entry.totalValueCNY = parseFloat(entry.totalValueCNY.toFixed(2));
      entry.totalCostCNY = parseFloat(entry.totalCostCNY.toFixed(2));
      entry.totalPnlCNY = parseFloat((entry.totalValueCNY - entry.totalCostCNY).toFixed(2));
      entry.pnlPercent = entry.totalCostCNY !== 0
        ? parseFloat(((entry.totalPnlCNY / entry.totalCostCNY) * 100).toFixed(2))
        : 0;
      entry.ytdPnlCNY = ytdByMarket[market] ?? 0;
    }

    return Response.json({
      success: true,
      data: marketData,
      meta: { timestamp: new Date().toISOString(), version: 'v1' },
    });
  } catch (err) {
    console.error('OpenClaw markets error:', err);
    return Response.json(
      { success: false, error: 'Internal server error', meta: { timestamp: new Date().toISOString(), version: 'v1' } },
      { status: 500 }
    );
  }
}
