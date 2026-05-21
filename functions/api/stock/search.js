/**
 * @fileoverview GET /api/stock/search?q=apple
 *
 * Proxies the Alpha Vantage SYMBOL_SEARCH endpoint and returns a normalised
 * array of matching securities.
 */

/**
 * GET handler — search for stock symbols.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  if (!query) {
    return Response.json(
      { success: false, error: 'Missing required query parameter: q' },
      { status: 400 },
    );
  }

  const apiKey = env.ALPHA_VANTAGE_KEY;
  if (!apiKey) {
    return Response.json(
      { success: false, error: 'Alpha Vantage API key is not configured' },
      { status: 503 },
    );
  }

  const apiUrl = `${env.ALPHA_VANTAGE_BASE}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${apiKey}`;
  const avResponse = await fetch(apiUrl);

  if (!avResponse.ok) {
    return Response.json(
      { success: false, error: `Alpha Vantage returned HTTP ${avResponse.status}` },
      { status: 502 },
    );
  }

  const avData = await avResponse.json();

  // Rate-limit / info note handling
  if (avData['Note'] || avData['Information']) {
    return Response.json(
      { success: false, error: avData['Note'] || avData['Information'] },
      { status: 429 },
    );
  }

  const bestMatches = avData['bestMatches'] ?? [];

  /** @type {Array<{symbol: string, name: string, type: string, region: string, currency: string}>} */
  const results = bestMatches.map((m) => ({
    symbol: m['1. symbol'] ?? '',
    name: m['2. name'] ?? '',
    type: m['3. type'] ?? '',
    region: m['4. region'] ?? '',
    currency: m['8. currency'] ?? '',
    matchScore: m['9. matchScore'] ?? '',
  }));

  return Response.json(
    { success: true, data: results },
    {
      headers: {
        // Search results are relatively stable — cache for 1 hour
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
