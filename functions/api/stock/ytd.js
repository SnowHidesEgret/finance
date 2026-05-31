/**
 * @fileoverview GET /api/stock/ytd?symbol=AAPL
 *
 * Fetches the YTD (Year-to-Date) baseline price (i.e. the closing price of the 
 * previous year) for a given symbol from Yahoo Finance and caches it.
 */

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();

  if (!symbol) {
    return Response.json(
      { success: false, error: 'Missing required query parameter: symbol' },
      { status: 400 },
    );
  }

  const db = env.DB;

  try {
    // 1. Check cache first
    const cached = await db
      .prepare(`SELECT ytd_price FROM quote_cache WHERE symbol = ?1`)
      .bind(symbol)
      .first();

    if (cached && cached.ytd_price !== null && cached.ytd_price !== undefined) {
      return Response.json(
        { success: true, data: { symbol, ytdPrice: cached.ytd_price, cached: true } },
        { headers: { 'Cache-Control': 'public, max-age=86400' } }
      );
    }

    // 2. Fetch from Yahoo Finance
    function translateSymbol(sym) {
      let s = sym.toUpperCase();
      if (s.endsWith('.HKG')) return s.replace('.HKG', '.HK');
      if (s.endsWith('.SHH')) return s.replace('.SHH', '.SS');
      if (s.endsWith('.SHZ')) return s.replace('.SHZ', '.SZ');
      if (s.endsWith('.SWX')) return s.replace('.SWX', '.SW');
      return s;
    }
    const yfSymbol = translateSymbol(symbol);
    const apiUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&useYfid=true&range=ytd`;
    
    const yfResponse = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!yfResponse.ok) {
      throw new Error(`Yahoo Finance returned HTTP ${yfResponse.status}`);
    }

    const yfData = await yfResponse.json();
    const result = yfData.chart?.result?.[0];
    
    if (!result || !result.meta || result.meta.chartPreviousClose == null) {
      throw new Error(`No YTD quote data found for symbol: ${symbol}`);
    }

    const ytdPrice = result.meta.chartPreviousClose;

    // 3. Upsert cache
    await db
      .prepare(
        `INSERT INTO quote_cache (symbol, ytd_price, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET
           ytd_price  = excluded.ytd_price`
      )
      .bind(symbol, ytdPrice)
      .run();

    return Response.json(
      { success: true, data: { symbol, ytdPrice, cached: false } },
      { headers: { 'Cache-Control': 'public, max-age=86400' } }
    );
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
