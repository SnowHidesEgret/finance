/**
 * @fileoverview Shared utilities and calculation logic for Agent API and Dashboard.
 *
 * Placed outside functions/ to avoid being treated as a Pages Functions route.
 */

// ────────────────────────────────────────────────────────────
// Constants & Mappings
// ────────────────────────────────────────────────────────────

/** Market → native currency mapping */
export const MARKET_CURRENCY = {
  A_SHARE: 'CNY',
  HK: 'HKD',
  US: 'USD',
  SWISS: 'CHF',
};

/**
 * Derive currency from market code.
 * Always derive currency from market — DB currency field may be wrong on old records.
 * @param {string} market
 * @returns {string} Currency code
 */
export function marketCurrency(market) {
  return MARKET_CURRENCY[market] || 'CNY';
}

/**
 * Fallback exchange rates (foreign-currency → CNY).
 * 1 unit of foreign currency = X CNY.
 */
export const FALLBACK_RATES = {
  USD: 7.2,    // 1 USD ≈ 7.2 CNY
  HKD: 0.923,  // 1 HKD ≈ 0.923 CNY
  CHF: 8.103,  // 1 CHF ≈ 8.103 CNY
  CNY: 1.0,
};

// ────────────────────────────────────────────────────────────
// Math & Formatting Helpers
// ────────────────────────────────────────────────────────────

/** Round to 2 decimal places. */
export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Round to 4 decimal places. */
export function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/** Standardize date string to YYYY-MM-DD for date comparison */
export function getYYYYMMDD(dateVal) {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
  }
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Get today's YYYY-MM-DD date formatted in the market's local timezone */
export function getMarketTodayYMD(market = 'A_SHARE', now = new Date()) {
  let timeZone = 'Asia/Shanghai';
  if (market === 'US') timeZone = 'America/New_York';
  else if (market === 'SWISS') timeZone = 'Europe/Zurich';
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(now);
  } catch {
    return getYYYYMMDD(now);
  }
}

/** Format timestamp to ISO-8601 UTC with 'Z' suffix */
export function formatIsoUtc(ts) {
  if (!ts) return null;
  if (typeof ts === 'string') {
    if (ts.endsWith('Z')) return ts;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(ts)) {
      return ts.replace(' ', 'T') + 'Z';
    }
  }
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toISOString();
}

/**
 * Normalise any rate (whether given as foreign-to-CNY or CNY-base) to foreign-to-CNY.
 * @param {string} currency
 * @param {Record<string, number>} rates
 * @returns {number} 1 unit of currency = X CNY
 */
export function getRateToCNY(currency, rates) {
  if (!currency || currency === 'CNY') return 1;
  const raw = rates?.[currency];
  if (!raw) return FALLBACK_RATES[currency] ?? 1;

  const num = Number(raw);
  if (!num || isNaN(num)) return FALLBACK_RATES[currency] ?? 1;

  if (currency === 'HKD') {
    return num > 1 ? 1 / num : num;
  }
  return num < 1 ? 1 / num : num;
}

// ────────────────────────────────────────────────────────────
// Envelope & Response Builders
// ────────────────────────────────────────────────────────────

/**
 * Build a successful Agent API response.
 * @param {object} data
 * @param {object} [extraMeta]
 * @param {ResponseInit} [init]
 * @returns {Response}
 */
export function successResponse(data, extraMeta = {}, init = {}) {
  const timestamp = new Date().toISOString();
  const headers = {
    'Cache-Control': 'no-store',
    ...(init.headers || {}),
  };
  return Response.json({
    success: true,
    data,
    meta: {
      timestamp,
      version: 'v1',
      ...extraMeta,
    },
  }, {
    ...init,
    headers,
  });
}

/**
 * Build an error Agent API response with unified code/message structure.
 * @param {string} code - English error code
 * @param {string} message - Chinese explanation
 * @param {number} [status=400]
 * @param {object} [extraError] - e.g. { hint: "..." }
 * @param {object} [extraMeta]
 * @param {ResponseInit} [init]
 * @returns {Response}
 */
export function errorResponse(code, message, status = 400, extraError = {}, extraMeta = {}, init = {}) {
  const timestamp = new Date().toISOString();
  const headers = {
    'Cache-Control': 'no-store',
    ...(init.headers || {}),
  };
  return Response.json({
    success: false,
    error: {
      code,
      message,
      ...extraError,
    },
    meta: {
      timestamp,
      version: 'v1',
      ...extraMeta,
    },
  }, {
    status,
    ...init,
    headers,
  });
}

// ────────────────────────────────────────────────────────────
// DB & Rates Helpers
// ────────────────────────────────────────────────────────────

/**
 * Load exchange rates with complete metadata (source, updatedAt, rateToCNY).
 * Strategy:
 *  1. Try exchange_rates table in D1
 *  2. If missing any currency, fetch Frankfurter API
 *  3. Fall back to FALLBACK_RATES
 *
 * @param {D1Database} db
 * @returns {Promise<{
 *   baseCurrency: string,
 *   rates: Record<string, { rateToCNY: number, source: string, updatedAt: string | null }>,
 *   pairs: Array<{ pair: string, currency: string, rate: number, source: string, updatedAt: string | null }>
 * }>}
 */
export async function loadRatesDetailed(db) {
  const resultRates = {
    CNY: { rateToCNY: 1.0, source: 'system', updatedAt: null },
    USD: null,
    HKD: null,
    CHF: null,
  };

  // 1. Try reading from DB
  if (db) {
    try {
      const { results } = await db.prepare(
        'SELECT base_currency, target_currency, rate, updated_at FROM exchange_rates'
      ).all();

      for (const row of results ?? []) {
        const rate = Number(row.rate);
        if (!rate) continue;
        const updatedAt = formatIsoUtc(row.updated_at);

        if (row.target_currency === 'CNY') {
          const curr = row.base_currency;
          if (curr in resultRates) {
            const rateToCNY = curr === 'HKD' ? (rate > 1 ? 1 / rate : rate) : (rate < 1 ? 1 / rate : rate);
            resultRates[curr] = { rateToCNY, source: 'database', updatedAt };
          }
        } else if (row.base_currency === 'CNY') {
          const curr = row.target_currency;
          if (curr in resultRates) {
            const rateToCNY = curr === 'HKD' ? (rate > 1 ? 1 / rate : rate) : (rate < 1 ? 1 / rate : rate);
            resultRates[curr] = { rateToCNY, source: 'database', updatedAt };
          }
        }
      }
    } catch (err) {
      console.warn('[loadRates] DB read failed:', err.message);
    }
  }

  // 2. If any currency is still missing, try Frankfurter API
  const currencies = ['USD', 'HKD', 'CHF'];
  const hasMissing = currencies.some(c => !resultRates[c]);

  if (hasMissing) {
    try {
      const res = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD,CHF');
      if (res.ok) {
        const data = await res.json();
        const dateIso = data.date ? `${data.date}T00:00:00Z` : new Date().toISOString();
        if (data.rates) {
          for (const curr of currencies) {
            if (!resultRates[curr] && data.rates[curr]) {
              const val = Number(data.rates[curr]);
              resultRates[curr] = {
                rateToCNY: 1 / val,
                source: 'live',
                updatedAt: dateIso,
              };
            }
          }
        }
      }
    } catch (e) {
      console.warn('[loadRates] Live fetch failed:', e.message);
    }
  }

  // 3. Fallback for any still missing
  for (const curr of currencies) {
    if (!resultRates[curr]) {
      resultRates[curr] = {
        rateToCNY: FALLBACK_RATES[curr],
        source: 'fallback',
        updatedAt: null,
      };
    }
  }

  const pairs = [
    { pair: 'USD/CNY', currency: 'USD', rate: round4(resultRates.USD.rateToCNY), source: resultRates.USD.source, updatedAt: resultRates.USD.updatedAt },
    { pair: 'HKD/CNY', currency: 'HKD', rate: round4(resultRates.HKD.rateToCNY), source: resultRates.HKD.source, updatedAt: resultRates.HKD.updatedAt },
    { pair: 'CHF/CNY', currency: 'CHF', rate: round4(resultRates.CHF.rateToCNY), source: resultRates.CHF.source, updatedAt: resultRates.CHF.updatedAt },
    { pair: 'CNY/CNY', currency: 'CNY', rate: 1.0, source: 'system', updatedAt: null },
  ];

  return {
    baseCurrency: 'CNY',
    rates: resultRates,
    pairs,
  };
}

/**
 * Return a simple Record<string, number> of foreign currency to CNY rates.
 * @param {D1Database} db
 * @returns {Promise<Record<string, number>>}
 */
export async function loadRates(db) {
  const detailed = await loadRatesDetailed(db);
  return {
    CNY: 1.0,
    USD: detailed.rates.USD.rateToCNY,
    HKD: detailed.rates.HKD.rateToCNY,
    CHF: detailed.rates.CHF.rateToCNY,
  };
}

/**
 * Build a keyed map of cached quotes: symbol → quote object.
 * @param {D1Database} db
 * @returns {Promise<Map<string, object>>}
 */
export async function loadQuoteMap(db) {
  const { results } = await db.prepare('SELECT * FROM quote_cache').all();
  const map = new Map();
  for (const row of results ?? []) {
    map.set(row.symbol.toUpperCase(), {
      symbol: row.symbol,
      price: row.price,
      prevClose: row.prev_close,
      changeAmount: row.change_amount,
      changePercent: row.change_percent,
      high: row.high,
      low: row.low,
      volume: row.volume,
      currency: row.currency,
      ytdPrice: row.ytd_price,
      mtdPrice: row.mtd_price,
      mtdMonth: row.mtd_month,
      ytdYear: row.ytd_year,
      updatedAt: row.updated_at,
      marketDate: row.updated_at ? row.updated_at.slice(0, 10) : null,
    });
  }
  return map;
}

// ────────────────────────────────────────────────────────────
// Core Calculation Logic (Shared by Dashboard & Agent API)
// ────────────────────────────────────────────────────────────

/**
 * Compute portfolio performance metrics.
 * Pure function extracted from functions/api/summary/index.js (lines 391–723).
 *
 * @param {object} params
 * @param {Array<object>} params.positions - Open and current year's closed positions
 * @param {Record<string, Array<object>>} params.tradesByPosition - Trades keyed by position_id
 * @param {Map<string, object>} params.quoteMap - Cached quotes keyed by uppercase symbol
 * @param {Record<string, number>} params.rates - Exchange rates (foreign to CNY or CNY base)
 * @param {Date} [params.now=new Date()] - Reference date
 * @returns {object} Calculated performance figures, market breakdowns, and position details
 */
export function computePortfolioPerformance({
  positions = [],
  tradesByPosition = {},
  quoteMap = new Map(),
  rates = {},
  now = new Date(),
}) {
  let totalValueCNY = 0;
  let totalCostCNY  = 0;
  let totalDayPnL   = 0;
  let portfolioYtdPnlCNY = 0;
  let portfolioMtdPnlCNY = 0;

  const marketBreakdown = {};
  const positionDetails = [];

  const nowMs = now.getTime();
  const currentYear = now.getFullYear();
  const currentYearStartStr = `${currentYear}-01-01`;
  const currentMonthKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthStartStr = `${currentMonthKey}-01`;

  for (const p of positions) {
    // Always derive currency from market — DB currency field may be wrong on old records
    const currency = marketCurrency(p.market);
    const rateToCNY = getRateToCNY(currency, rates);

    const liveQuote    = quoteMap.get(p.symbol?.toUpperCase());
    const currentPrice = liveQuote?.price ?? p.open_price;
    const prevClose    = liveQuote?.prevClose ?? liveQuote?.prev_close ?? p.open_price;
    const ytdPrice     = liveQuote?.ytdPrice ?? liveQuote?.ytd_price; // Dec 31 of last year
    const mtdPrice     = liveQuote?.mtdPrice ?? liveQuote?.mtd_price; // Last trading day of previous month
    const hasLivePrice = !!liveQuote;

    // Cost in original currency (open_price is in the position's own currency)
    const costOriginal   = p.open_price * p.quantity + (p.commission ?? 0);
    const costCNY        = round2(costOriginal * rateToCNY);

    // Market value in CNY using live price + live exchange rate
    const valueOriginal  = currentPrice * p.quantity;
    const valueCNY       = round2(valueOriginal * rateToCNY);

    const pnlCNY         = round2(valueCNY - costCNY);
    const pnlPercent     = costCNY !== 0 ? round2((pnlCNY / costCNY) * 100) : 0;
    
    // Lot-level calculation & Realized YTD/MTD from partial/full sales
    const pTrades = tradesByPosition[p.id] || [];
    const buyTrades = [];
    const sellTrades = [];
    for (const t of pTrades) {
      if (t.trade_type === 'SELL') sellTrades.push(t);
      else if (t.trade_type === 'BUY') buyTrades.push(t);
    }
    
    const buyLots = buyTrades.map(t => ({ ...t, remaining: t.quantity }));
    let realizedYtdPnlNative = 0;
    let realizedYtdBaseNative = 0;
    let realizedMtdPnlNative = 0;
    let realizedMtdBaseNative = 0;
    
    for (const sell of sellTrades) {
      let sellQty = sell.quantity;
      const sellYMD = getYYYYMMDD(sell.trade_date);
      const isSellThisYear = (sellYMD >= currentYearStartStr);
      const isSellThisMonth = (sellYMD >= currentMonthStartStr);

      for (const buy of buyLots) {
        if (sellQty <= 0) break;
        if (buy.remaining <= 0) continue;

        const matchedQty = Math.min(sellQty, buy.remaining);
        sellQty -= matchedQty;
        buy.remaining -= matchedQty;

        if (isSellThisYear) {
           const buyYMD = getYYYYMMDD(buy.trade_date);
           let lotYtdBasePrice = buy.price;
           if (buyYMD < currentYearStartStr && ytdPrice && ytdPrice > 0) {
             lotYtdBasePrice = ytdPrice;
           }
           const lotYtdBaseNative = matchedQty * lotYtdBasePrice;
           const lotProceedsNative = matchedQty * sell.price;
           realizedYtdPnlNative += (lotProceedsNative - lotYtdBaseNative);
           realizedYtdBaseNative += lotYtdBaseNative;
        }

        if (isSellThisMonth) {
           const buyYMD = getYYYYMMDD(buy.trade_date);
           let lotMtdBasePrice = buy.price;
           if (buyYMD < currentMonthStartStr) {
             if (mtdPrice && mtdPrice > 0) lotMtdBasePrice = mtdPrice;
             else if (buyYMD < currentYearStartStr && ytdPrice && ytdPrice > 0) lotMtdBasePrice = ytdPrice;
             else if (prevClose && prevClose > 0) lotMtdBasePrice = prevClose;
           }
           const lotMtdBaseNative = matchedQty * lotMtdBasePrice;
           const lotProceedsNative = matchedQty * sell.price;
           realizedMtdPnlNative += (lotProceedsNative - lotMtdBaseNative);
           realizedMtdBaseNative += lotMtdBaseNative;
        }
      }
    }
    
    const activeLots = buyLots.filter(b => b.remaining > 0).map(b => ({ ...b, activeQuantity: b.remaining }));
    
    let weightedHoldingDays = 0;
    let lotTotalCostCNY = 0;
    const processedLots = [];
    
    let totalYtdPnLNative = 0;
    let totalYtdBaseNative = 0;
    let totalMtdPnLNative = 0;
    let totalMtdBaseNative = 0;
    
    for (const lot of activeLots) {
      const lotDays = Math.max(1, Math.floor((nowMs - new Date(lot.trade_date).getTime()) / (1000 * 60 * 60 * 24)));
      const lotCostNative = lot.activeQuantity * lot.price;
      const lotCostCNYValue = lotCostNative * (lot.rate_to_cny || rateToCNY || 1);
      
      const lotValueNative = lot.activeQuantity * currentPrice;
      const lotPnLNative = lotValueNative - lotCostNative;
      const lotPnlPercent = lotCostNative > 0 ? (lotPnLNative / lotCostNative) * 100 : 0;
      const lotAnnualizedReturn = lotDays > 0 ? (lotPnlPercent / lotDays) * 365 : 0;
      
      // Lot YTD calculation
      const lotYMD = getYYYYMMDD(lot.trade_date);
      let lotYtdBasePrice = lot.price; // default to purchase price if bought this year
      if (lotYMD < currentYearStartStr && ytdPrice && ytdPrice > 0) {
        lotYtdBasePrice = ytdPrice; // use last year close if bought before this year
      }
      
      const lotYtdBaseNative = lot.activeQuantity * lotYtdBasePrice;
      const lotYtdPnLNative = lotValueNative - lotYtdBaseNative;
      
      totalYtdBaseNative += lotYtdBaseNative;
      totalYtdPnLNative += lotYtdPnLNative;

      // Lot MTD calculation (自然月基准)
      let lotMtdBasePrice = lot.price; // default to purchase price if bought in current month
      if (lotYMD < currentMonthStartStr) {
        if (mtdPrice && mtdPrice > 0) {
          lotMtdBasePrice = mtdPrice;
        } else if (lotYMD < currentYearStartStr && ytdPrice && ytdPrice > 0) {
          lotMtdBasePrice = ytdPrice;
        } else if (prevClose && prevClose > 0) {
          lotMtdBasePrice = prevClose;
        }
      }

      const lotMtdBaseNative = lot.activeQuantity * lotMtdBasePrice;
      const lotMtdPnLNative = lotValueNative - lotMtdBaseNative;

      totalMtdBaseNative += lotMtdBaseNative;
      totalMtdPnLNative += lotMtdPnLNative;
      
      processedLots.push({
        ...lot,
        holdingDays: lotDays,
        costNative: round2(lotCostNative),
        valueNative: round2(lotValueNative),
        pnlNative: round2(lotPnLNative),
        pnlPercent: round2(lotPnlPercent),
        annualizedReturn: round2(lotAnnualizedReturn),
        ytdPercent: lotYtdBaseNative > 0 ? round2((lotYtdPnLNative / lotYtdBaseNative) * 100) : 0,
        mtdPercent: lotMtdBaseNative > 0 ? round2((lotMtdPnLNative / lotMtdBaseNative) * 100) : 0,
      });
      
      weightedHoldingDays += lotDays * lotCostCNYValue;
      lotTotalCostCNY += lotCostCNYValue;
    }
    
    const positionYtdBaseNative = totalYtdBaseNative + realizedYtdBaseNative;
    const positionYtdPnLNative = totalYtdPnLNative + realizedYtdPnlNative;
    const ytdPercent = positionYtdBaseNative > 0 ? round2((positionYtdPnLNative / positionYtdBaseNative) * 100) : 0;
    
    const positionMtdBaseNative = totalMtdBaseNative + realizedMtdBaseNative;
    const positionMtdPnLNative = totalMtdPnLNative + realizedMtdPnlNative;
    const mtdPercent = positionMtdBaseNative > 0 ? round2((positionMtdPnLNative / positionMtdBaseNative) * 100) : 0;

    // Find the earliest trade date among ALL buy trades for this continuous position
    let earliestDate = p.open_date;
    if (buyTrades.length > 0) {
      earliestDate = buyTrades[0].trade_date;
      for (const t of buyTrades) {
        if (new Date(t.trade_date) < new Date(earliestDate)) {
          earliestDate = t.trade_date;
        }
      }
    }
    
    // Holding days for UI display (from earliest trade date)
    const displayHoldingDays = Math.max(1, Math.floor((nowMs - new Date(earliestDate).getTime()) / (1000 * 60 * 60 * 24)));
    const avgHoldingDays = lotTotalCostCNY > 0 ? Math.max(1, Math.round(weightedHoldingDays / lotTotalCostCNY)) : displayHoldingDays;

    // Return rates (using avgHoldingDays)
    const holdingDays = displayHoldingDays;
    const annualizedReturn = round2((pnlPercent / avgHoldingDays) * 365);
    const monthlyReturn    = mtdPercent;

    // Day PnL
    // For stocks/lots bought on or after the quote date (or today in market timezone), use purchase price as baseline price
    const effectiveQuoteDate = liveQuote?.marketDate || getMarketTodayYMD(p.market, now);
    let dayChangeCNY = 0;
    if (activeLots && activeLots.length > 0) {
      let totalDayPnLNative = 0;
      for (const lot of activeLots) {
        const lotTradeYMD = getYYYYMMDD(lot.trade_date);
        const isLotBoughtToday = lotTradeYMD && lotTradeYMD >= effectiveQuoteDate;
        const basePrice = isLotBoughtToday ? lot.price : prevClose;
        totalDayPnLNative += (currentPrice - basePrice) * lot.activeQuantity;
      }
      dayChangeCNY = round2(totalDayPnLNative * rateToCNY);
    } else {
      const posOpenYMD = getYYYYMMDD(p.open_date);
      const isPositionBoughtToday = posOpenYMD && posOpenYMD >= effectiveQuoteDate;
      const basePrice = isPositionBoughtToday ? p.open_price : prevClose;
      dayChangeCNY = round2((currentPrice - basePrice) * p.quantity * rateToCNY);
    }

    // Accumulate YTD & MTD PnL in CNY (includes both active and realized)
    const posYtdPnlCNY = round2(positionYtdPnLNative * rateToCNY);
    const posMtdPnlCNY = round2(positionMtdPnLNative * rateToCNY);
    portfolioYtdPnlCNY += posYtdPnlCNY;
    portfolioMtdPnlCNY += posMtdPnlCNY;

    const mkt = p.market;
    if (!marketBreakdown[mkt]) {
      marketBreakdown[mkt] = { value: 0, cost: 0, count: 0, pnl: 0, dayPnl: 0, weightedDays: 0, ytdPnl: 0, mtdPnl: 0 };
    }

    // If position is closed, only add its YTD/MTD to portfolio & market breakdown, skip active metrics
    if (p.status === 'CLOSED') {
      marketBreakdown[mkt].ytdPnl += posYtdPnlCNY;
      marketBreakdown[mkt].mtdPnl += posMtdPnlCNY;
      continue;
    }

    totalValueCNY += valueCNY;
    totalCostCNY  += costCNY;
    totalDayPnL   += dayChangeCNY;
    marketBreakdown[mkt].value  += valueCNY;
    marketBreakdown[mkt].cost   += costCNY;
    marketBreakdown[mkt].count  += 1;
    marketBreakdown[mkt].pnl    += pnlCNY;
    marketBreakdown[mkt].dayPnl += dayChangeCNY;
    marketBreakdown[mkt].weightedDays += avgHoldingDays * valueCNY;
    marketBreakdown[mkt].ytdPnl += posYtdPnlCNY;
    marketBreakdown[mkt].mtdPnl += posMtdPnlCNY;

    positionDetails.push({
      ...p,
      currency,
      currentPrice,
      prevClose,
      ytdPrice,
      ytdPercent,
      mtdPrice,
      mtdPercent,
      rateToCNY,
      costCNY,
      marketValueCNY: valueCNY,
      pnlCNY,
      pnlPercent,
      holdingDays, // used for UI display
      avgHoldingDays, // actual holding days used for math
      annualizedReturn,
      monthlyReturn: mtdPercent,
      dayPnLCNY: dayChangeCNY,
      ytdPnLCNY: posYtdPnlCNY,
      mtdPnLCNY: posMtdPnlCNY,
      hasLivePrice,
      activeLots: processedLots,
      weight: 0, // calculated below
      weightPercent: 0,
    });
  }

  // Compute weights
  for (const pd of positionDetails) {
    pd.weight = totalValueCNY > 0 ? round2((pd.marketValueCNY / totalValueCNY) * 100) : 0;
    pd.weightPercent = pd.weight;
  }

  const totalPnlCNY     = round2(totalValueCNY - totalCostCNY);
  const totalPnlPercent = totalCostCNY !== 0 ? round2((totalPnlCNY / totalCostCNY) * 100) : 0;
  portfolioYtdPnlCNY = round2(portfolioYtdPnlCNY);
  portfolioMtdPnlCNY = round2(portfolioMtdPnlCNY);

  // Portfolio-level weighted average holding days & return rates
  let totalWeightedDays = 0;
  for (const pd of positionDetails) {
    totalWeightedDays += pd.avgHoldingDays * pd.marketValueCNY;
  }
  const totalAvgHoldingDays   = totalValueCNY > 0 ? Math.max(1, Math.round(totalWeightedDays / totalValueCNY)) : 1;
  const totalAnnualizedReturn = round2((totalPnlPercent / totalAvgHoldingDays) * 365);
  
  const mtdCapitalBase = round2(totalValueCNY - portfolioMtdPnlCNY);
  const totalMonthlyReturn = mtdCapitalBase > 0
    ? round2((portfolioMtdPnlCNY / mtdCapitalBase) * 100)
    : 0;

  // Portfolio YTD %
  const ytdCapitalBase = round2(totalValueCNY - portfolioYtdPnlCNY);
  const portfolioYtdPercent = ytdCapitalBase > 0
    ? round2((portfolioYtdPnlCNY / ytdCapitalBase) * 100)
    : 0;

  // Build per-market stats
  const markets = {};
  for (const [mkt, data] of Object.entries(marketBreakdown)) {
    const mktPnlPct = data.cost !== 0 ? round2((data.pnl / data.cost) * 100) : 0;
    const mktYearStartValue = data.value - data.ytdPnl;
    const ytdPercent = mktYearStartValue > 0 ? round2((data.ytdPnl / mktYearStartValue) * 100) : 0;
    const mktMonthStartValue = data.value - data.mtdPnl;
    const mtdPercent = mktMonthStartValue > 0 ? round2((data.mtdPnl / mktMonthStartValue) * 100) : 0;
    const avgDays   = data.value > 0 ? Math.max(1, Math.round(data.weightedDays / data.value)) : 1;
    markets[mkt] = {
      totalValue:       round2(data.value),
      totalCost:        round2(data.cost),
      totalPnL:         round2(data.pnl),
      totalValueCNY:    round2(data.value),
      totalCostCNY:     round2(data.cost),
      totalPnlCNY:      round2(data.pnl),
      pnlPercent:       mktPnlPct,
      avgHoldingDays:   avgDays,
      annualizedReturn: round2((mktPnlPct / avgDays) * 365),
      monthlyReturn:    mtdPercent,
      mtdPercent:       mtdPercent,
      mtdPnlCNY:        round2(data.mtdPnl),
      positionCount:    data.count,
      dayPnL:           round2(data.dayPnl),
      ytdPnlCNY:        round2(data.ytdPnl),
      ytdPercent:       ytdPercent,
    };
  }

  return {
    totalValueCNY: round2(totalValueCNY),
    totalCostCNY:  round2(totalCostCNY),
    totalPnlCNY,
    totalPnlPercent,
    totalDayPnL:   round2(totalDayPnL),
    portfolioYtdPnlCNY,
    portfolioYtdPercent,
    portfolioMtdPnlCNY,
    totalMonthlyReturn,
    totalAvgHoldingDays,
    totalAnnualizedReturn,
    marketBreakdown,
    markets,
    positionDetails,
  };
}
