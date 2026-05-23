/**
 * @fileoverview GET /api/stock/search?q=apple
 *
 * Proxies the Yahoo Finance Search API and returns a normalised
 * array of matching securities.
 */

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  if (!query) {
    return Response.json(
      { success: false, error: 'Missing required query parameter: q' },
      { status: 400 },
    );
  }

  const apiUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  
  try {
    const yfResponse = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!yfResponse.ok) {
      return Response.json(
        { success: false, error: `Yahoo Finance returned HTTP ${yfResponse.status}` },
        { status: 502 },
      );
    }

    const yfData = await yfResponse.json();
    const quotes = yfData.quotes ?? [];

    const results = quotes
      .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'MUTUALFUND' || q.quoteType === 'INDEX')
      .map((q) => ({
        symbol: q.symbol ?? '',
        name: q.longname ?? q.shortname ?? '',
        type: q.quoteType ?? '',
        region: q.exchDisp ?? '',
        currency: '', 
        matchScore: q.score ?? '',
      }));

    return Response.json(
      { success: true, data: results },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      },
    );
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
