/**
 * @fileoverview GET /api/summary
 *
 * Returns a global portfolio summary across all markets.
 * - Fetches live exchange rates from Frankfurter
 * - Directly fetches live prices from Yahoo Finance for all open positions
 * - Stores fetched prices into quote_cache for reuse by other endpoints
 * - Computes PnL in CNY using live rates
 */

/** Translate legacy Alpha Vantage symbol suffixes → Yahoo Finance format */
function toYahooSymbol(sym) {
  const s = (sym || '').toUpperCase();
  if (s.endsWith('.HKG')) return s.replace('.HKG', '.HK');
  if (s.endsWith('.SHH')) return s.replace('.SHH', '.SS');
  if (s.endsWith('.SHZ')) return s.replace('.SHZ', '.SZ');
  if (s.endsWith('.SWX')) return s.replace('.SWX', '.SW');
  return s;
}

/** Get the currency for a given market */
function marketCurrency(market) {
  switch (market) {
    case 'US':      return 'USD';
    case 'HK':      return 'HKD';
    case 'SWISS':   return 'CHF';
    case 'A_SHARE': return 'CNY';
    default:        return 'CNY';
  }
}

/** Round to 2 decimal places. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Standardize date string to YYYY-MM-DD for date comparison */
function getYYYYMMDD(dateVal) {
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
function getMarketTodayYMD(market = 'A_SHARE', now = new Date()) {
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

/**
 * Fetch a single quote from Yahoo Finance chart API.
 * Returns { price, prevClose, currency, marketDate } or null on failure.
 */
async function fetchYahooQuote(yfSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&range=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;

    let marketDate = null;
    if (meta.regularMarketTime) {
      const tz = meta.exchangeTimezoneName || 'Asia/Shanghai';
      try {
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        marketDate = fmt.format(new Date(meta.regularMarketTime * 1000));
      } catch {
        marketDate = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10);
      }
    }

    return {
      price:      meta.regularMarketPrice,
      prevClose:  meta.chartPreviousClose || meta.regularMarketPrice,
      currency:   meta.currency || '',
      marketDate: marketDate,
    };
  } catch {
    return null;
  }
}


/**
 * GET handler — global portfolio summary.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env } = context;

  // ── 1. Fetch live exchange rates (CNY base) ─────────────────────────
  // rates = { USD: 0.1389, HKD: 1.0833, CHF: 0.1234 }  (1 CNY = X foreign)
  let rates = { USD: 0.1389, HKD: 1.0833, CHF: 0.1234 };
  try {
    const rateRes = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD,CHF');
    if (rateRes.ok) {
      const rateData = await rateRes.json();
      if (rateData.rates) rates = { ...rates, ...rateData.rates };
    }
  } catch (e) {
    console.warn('[summary] Exchange rate fetch failed, using fallback:', e.message);
  }

  // Helper: convert any amount in `currency` to CNY
  function toCNY(amount, currency) {
    if (!currency || currency === 'CNY') return amount;
    const r = rates[currency];
    return r ? amount / r : amount;
  }

  // ── 2. Load all open & this year's closed positions from DB ─────────
  const currentYearStr = new Date().getFullYear().toString();
  const { results: positions } = await env.DB.prepare(
    `SELECT * FROM positions 
     WHERE status = 'OPEN' 
        OR (status = 'CLOSED' AND close_date >= '${currentYearStr}-01-01')
     ORDER BY market, open_date DESC`,
  ).all();

  if (!positions || positions.length === 0) {
    return Response.json({
      success: true,
      data: {
        totalValueCNY: 0, totalCostCNY: 0, totalPnlCNY: 0,
        totalPnlPercent: 0, positionCount: 0,
        marketCounts: {}, markets: {}, marketSummaries: {},
        positions: [], exchangeRates: rates,
      },
    });
  }

  // Load all trades for active positions to compute lot-level returns
  const posIds = positions.map(p => `'${p.id}'`).join(',');
  let allTrades = [];
  if (posIds) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM trades WHERE position_id IN (${posIds}) ORDER BY trade_date ASC, created_at ASC`
    ).all();
    allTrades = results || [];
  }
  
  const tradesByPosition = {};
  for (const t of allTrades) {
    if (!tradesByPosition[t.position_id]) tradesByPosition[t.position_id] = [];
    tradesByPosition[t.position_id].push(t);
  }

/**
 * Fetch YTD price from Yahoo Finance chart API.
 */
async function fetchYtdPrice(yfSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&range=ytd`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || meta.chartPreviousClose == null) return null;
    return meta.chartPreviousClose;
  } catch {
    return null;
  }
}

/**
 * Fetch MTD (Month-To-Date) baseline price (closing price of the previous natural month)
 * for a given symbol from Yahoo Finance, accurately respecting the exchange's local timezone.
 */
async function fetchMtdPrice(yfSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&range=2mo`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) return null;

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const timeZone = result.meta?.exchangeTimezoneName || 'Asia/Shanghai';

    const now = new Date();
    const currentFmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' });
    const currentParts = currentFmt.formatToParts(now);
    let curYear = now.getFullYear();
    let curMonth = now.getMonth();
    for (const p of currentParts) {
      if (p.type === 'year') curYear = parseInt(p.value, 10);
      if (p.type === 'month') curMonth = parseInt(p.value, 10) - 1;
    }

    const candleFmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' });

    let prevMonthClose = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (closes[i] == null) continue;
      const cDate = new Date(timestamps[i] * 1000);
      const cParts = candleFmt.formatToParts(cDate);
      let cYear = cDate.getFullYear();
      let cMonth = cDate.getMonth();
      for (const p of cParts) {
        if (p.type === 'year') cYear = parseInt(p.value, 10);
        if (p.type === 'month') cMonth = parseInt(p.value, 10) - 1;
      }

      if (cYear < curYear || (cYear === curYear && cMonth < curMonth)) {
        prevMonthClose = closes[i];
        break;
      }
    }
    return prevMonthClose;
  } catch {
    return null;
  }
}

  // ── 3. Fetch live quotes, YTD & MTD prices in parallel ────────────
  // Deduplicate symbols
  const uniqueSymbols = [...new Set(positions.map(p => p.symbol))];
  
  // Pre-load ytd_price & mtd_price from cache
  let cachedYtdMap = new Map();
  let cachedMtdMap = new Map();
  if (uniqueSymbols.length > 0) {
    const symbolsList = uniqueSymbols.map(s => `'${s}'`).join(',');
    try {
      const { results: cachedQuotes } = await env.DB.prepare(
        `SELECT symbol, ytd_price, mtd_price FROM quote_cache WHERE symbol IN (${symbolsList})`
      ).all();
      for (const row of cachedQuotes || []) {
        if (row.ytd_price != null) cachedYtdMap.set(row.symbol, row.ytd_price);
        if (row.mtd_price != null) cachedMtdMap.set(row.symbol, row.mtd_price);
      }
    } catch (e) {
      console.warn('[summary] Failed to read quote_cache:', e.message);
      // Auto-migrate missing columns if D1 table schema is outdated
      if (e.message && (e.message.includes('no such column: mtd_price') || e.message.includes('no such column: ytd_price'))) {
        try {
          if (e.message.includes('mtd_price')) {
            await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN mtd_price REAL").run();
            console.log('[summary] Auto-added missing mtd_price column to quote_cache');
          }
          if (e.message.includes('ytd_price')) {
            await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN ytd_price REAL").run();
            console.log('[summary] Auto-added missing ytd_price column to quote_cache');
          }
        } catch (alterErr) {
          console.warn('[summary] Failed to auto-migrate quote_cache schema:', alterErr.message);
        }
      }
    }
  }

  const quoteResults = await Promise.all(
    uniqueSymbols.map(async (sym) => {
      const yfSym = toYahooSymbol(sym);
      const quotePromise = fetchYahooQuote(yfSym);
      let ytdPricePromise = Promise.resolve(cachedYtdMap.get(sym.toUpperCase()));
      let mtdPricePromise = Promise.resolve(cachedMtdMap.get(sym.toUpperCase()));
      
      if (!cachedYtdMap.has(sym.toUpperCase())) {
        ytdPricePromise = fetchYtdPrice(yfSym);
      }
      if (!cachedMtdMap.has(sym.toUpperCase())) {
        mtdPricePromise = fetchMtdPrice(yfSym);
      }
      
      const [quote, ytdPrice, mtdPrice] = await Promise.all([quotePromise, ytdPricePromise, mtdPricePromise]);
      return { sym, yfSym, quote, ytdPrice, mtdPrice };
    })
  );

  // Build quote map: original_symbol → quote data
  const quoteMap = new Map();
  for (const { sym, yfSym, quote, ytdPrice, mtdPrice } of quoteResults) {
    if (quote) {
      quote.ytdPrice = ytdPrice;
      quote.mtdPrice = mtdPrice;
      quoteMap.set(sym.toUpperCase(), quote);
      // Also save to quote_cache for other endpoints (fire and forget)
      try {
        await env.DB.prepare(
          `INSERT INTO quote_cache (symbol, price, change_amount, change_percent, high, low, volume, prev_close, ytd_price, mtd_price, currency, updated_at)
           VALUES (?1, ?2, ?3, ?4, 0, 0, 0, ?5, ?6, ?7, ?8, datetime('now'))
           ON CONFLICT(symbol) DO UPDATE SET
             price = excluded.price,
             change_amount = excluded.change_amount,
             change_percent = excluded.change_percent,
             prev_close = excluded.prev_close,
             ytd_price = excluded.ytd_price,
             mtd_price = excluded.mtd_price,
             currency = excluded.currency,
             updated_at = datetime('now')`,
        ).bind(
          sym.toUpperCase(),
          quote.price,
          round2(quote.price - quote.prevClose),
          quote.prevClose ? round2(((quote.price - quote.prevClose) / quote.prevClose) * 100) : 0,
          quote.prevClose,
          ytdPrice,
          mtdPrice,
          quote.currency,
        ).run();
      } catch (e) {
        if (e.message && (e.message.includes('no such column: mtd_price') || e.message.includes('no such column: ytd_price'))) {
          try {
            if (e.message.includes('mtd_price')) {
              await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN mtd_price REAL").run();
            }
            if (e.message.includes('ytd_price')) {
              await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN ytd_price REAL").run();
            }
            // Retry insert once
            await env.DB.prepare(
              `INSERT INTO quote_cache (symbol, price, change_amount, change_percent, high, low, volume, prev_close, ytd_price, mtd_price, currency, updated_at)
               VALUES (?1, ?2, ?3, ?4, 0, 0, 0, ?5, ?6, ?7, ?8, datetime('now'))
               ON CONFLICT(symbol) DO UPDATE SET
                 price = excluded.price,
                 change_amount = excluded.change_amount,
                 change_percent = excluded.change_percent,
                 prev_close = excluded.prev_close,
                 ytd_price = excluded.ytd_price,
                 mtd_price = excluded.mtd_price,
                 currency = excluded.currency,
                 updated_at = datetime('now')`,
            ).bind(
              sym.toUpperCase(),
              quote.price,
              round2(quote.price - quote.prevClose),
              quote.prevClose ? round2(((quote.price - quote.prevClose) / quote.prevClose) * 100) : 0,
              quote.prevClose,
              ytdPrice,
              mtdPrice,
              quote.currency,
            ).run();
          } catch (retryErr) {
            console.warn('[summary] Failed to update quote_cache after column auto-migration for', sym, retryErr.message);
          }
        } else {
          console.warn('[summary] Failed to update quote_cache for', sym, e.message);
        }
      }
    }
  }

  // ── 4. Compute portfolio summary ────────────────────────────────────
  let totalValueCNY = 0;
  let totalCostCNY  = 0;
  let totalDayPnL   = 0;
  let portfolioYtdPnlCNY = 0;
  let portfolioMtdPnlCNY = 0;

  const marketBreakdown = {};
  const positionDetails = [];

  for (const p of positions) {
    // Always derive currency from market — DB currency field may be wrong on old records
    const currency = marketCurrency(p.market);
    const rateToCNY = currency === 'CNY' ? 1 : (rates[currency] ? 1 / rates[currency] : 1);

    const liveQuote   = quoteMap.get(p.symbol?.toUpperCase());
    const currentPrice = liveQuote?.price ?? p.open_price;
    const prevClose    = liveQuote?.prevClose ?? p.open_price;
    const ytdPrice     = liveQuote?.ytdPrice; // Dec 31 of last year
    const mtdPrice     = liveQuote?.mtdPrice; // Last trading day of previous month
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
    
    const nowMs = Date.now();
    const nowObj = new Date();
    const currentYear = nowObj.getFullYear();
    const currentMonth = nowObj.getMonth();
    const monthStartMs = new Date(currentYear, currentMonth, 1).getTime();
    
    for (const sell of sellTrades) {
      let sellQty = sell.quantity;
      const sellDate = new Date(sell.trade_date);
      const isSellThisYear = (sellDate.getFullYear() === currentYear);
      const isSellThisMonth = (isSellThisYear && sellDate.getMonth() === currentMonth);

      for (const buy of buyLots) {
        if (sellQty <= 0) break;
        if (buy.remaining <= 0) continue;

        const matchedQty = Math.min(sellQty, buy.remaining);
        sellQty -= matchedQty;
        buy.remaining -= matchedQty;

        if (isSellThisYear) {
           const buyYear = new Date(buy.trade_date).getFullYear();
           let lotYtdBasePrice = buy.price;
           if (buyYear < currentYear && ytdPrice && ytdPrice > 0) {
             lotYtdBasePrice = ytdPrice;
           }
           const lotYtdBaseNative = matchedQty * lotYtdBasePrice;
           const lotProceedsNative = matchedQty * sell.price;
           realizedYtdPnlNative += (lotProceedsNative - lotYtdBaseNative);
           realizedYtdBaseNative += lotYtdBaseNative;
        }

        if (isSellThisMonth) {
           const buyDate = new Date(buy.trade_date);
           let lotMtdBasePrice = buy.price;
           if (buyDate.getTime() < monthStartMs) {
             if (mtdPrice && mtdPrice > 0) lotMtdBasePrice = mtdPrice;
             else if (buyDate.getFullYear() < currentYear && ytdPrice && ytdPrice > 0) lotMtdBasePrice = ytdPrice;
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
      const lotDate = new Date(lot.trade_date);
      const lotYear = lotDate.getFullYear();
      let lotYtdBasePrice = lot.price; // default to purchase price if bought this year
      if (lotYear < currentYear && ytdPrice && ytdPrice > 0) {
        lotYtdBasePrice = ytdPrice; // use last year close if bought before this year
      }
      
      const lotYtdBaseNative = lot.activeQuantity * lotYtdBasePrice;
      const lotYtdPnLNative = lotValueNative - lotYtdBaseNative;
      
      totalYtdBaseNative += lotYtdBaseNative;
      totalYtdPnLNative += lotYtdPnLNative;

      // Lot MTD calculation (自然月基准)
      let lotMtdBasePrice = lot.price; // default to purchase price if bought in current month
      if (lotDate.getTime() < monthStartMs) {
        if (mtdPrice && mtdPrice > 0) {
          lotMtdBasePrice = mtdPrice;
        } else if (lotYear < currentYear && ytdPrice && ytdPrice > 0) {
          lotMtdBasePrice = ytdPrice;
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
    const effectiveQuoteDate = liveQuote?.marketDate || getMarketTodayYMD(p.market, nowObj);
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
    });
  }

  // Compute weights
  for (const pd of positionDetails) {
    pd.weight = totalValueCNY > 0 ? round2((pd.marketValueCNY / totalValueCNY) * 100) : 0;
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

  // ── 5. Calculate portfolio YTD % ────────────────────────────────────
  // 为了解决年中大额加仓导致的 YTD 收益率失真（分子包含新购持仓利润，但分母由于严格倒推而缺少对应本金），
  // 这里统一使用“YTD 成本基准 (YTD Capital Base)”作为分母。
  // YTD 成本基准 = 当前总市值 - YTD 绝对收益。
  // 在数学上，它完全等价于：年初实际资产 + 年内净转入本金。
  // 这不仅消除了年初快照缺失时的复杂倒推误差，也和下方的分市场 YTD 计算逻辑保持了完美一致。
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

  // ── 6. Write daily snapshot (fire and forget) ───────────────────────
  const today = new Date().toISOString().split('T')[0];
  try {
    const snapshotStmts = [];
    // Per-market snapshots
    for (const [mkt, data] of Object.entries(marketBreakdown)) {
      snapshotStmts.push(
        env.DB.prepare(
          `INSERT INTO portfolio_snapshots (snapshot_date, market, total_value_cny, total_cost_cny, total_pnl_cny, ytd_pnl_cny, position_count)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(snapshot_date, market) DO UPDATE SET
             total_value_cny = excluded.total_value_cny,
             total_cost_cny  = excluded.total_cost_cny,
             total_pnl_cny   = excluded.total_pnl_cny,
             ytd_pnl_cny     = excluded.ytd_pnl_cny,
             position_count  = excluded.position_count`
        ).bind(today, mkt, round2(data.value), round2(data.cost), round2(data.pnl), round2(data.ytdPnl), data.count)
      );
    }
    // ALL summary snapshot
    snapshotStmts.push(
      env.DB.prepare(
        `INSERT INTO portfolio_snapshots (snapshot_date, market, total_value_cny, total_cost_cny, total_pnl_cny, ytd_pnl_cny, position_count)
         VALUES (?1, 'ALL', ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(snapshot_date, market) DO UPDATE SET
           total_value_cny = excluded.total_value_cny,
           total_cost_cny  = excluded.total_cost_cny,
           total_pnl_cny   = excluded.total_pnl_cny,
           ytd_pnl_cny     = excluded.ytd_pnl_cny,
           position_count  = excluded.position_count`
      ).bind(today, round2(totalValueCNY), round2(totalCostCNY), totalPnlCNY, portfolioYtdPnlCNY, positionDetails.length)
    );
    await env.DB.batch(snapshotStmts);
  } catch (e) {
    console.warn('[summary] Failed to write snapshots:', e.message);
  }

  return Response.json(
    {
      success: true,
      data: {
        totalValueCNY:  round2(totalValueCNY),
        totalCostCNY:   round2(totalCostCNY),
        totalPnlCNY,
        totalPnlPercent,
        totalAvgHoldingDays,
        totalAnnualizedReturn,
        totalMonthlyReturn,
        portfolioYtdPnlCNY,
        portfolioYtdPercent,
        dayPnl:         round2(totalDayPnL),
        positionCount:  positionDetails.length,
        marketCounts:   Object.fromEntries(Object.entries(marketBreakdown).map(([m, d]) => [m, d.count])),
        markets,
        marketSummaries: markets,
        positions:       positionDetails,
        exchangeRates:   rates,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
