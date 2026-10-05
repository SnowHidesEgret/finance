/**
 * @fileoverview GET /api/agent/search?q= — Symbol and security search.
 *
 * Route:
 *   GET /api/agent/search?q=apple
 *   GET /api/agent/search?q=腾讯
 *
 * Proxies Yahoo Finance Search API and normalises securities into clean items.
 */

import { successResponse, errorResponse } from '../../../lib/agent-common.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  if (!query) {
    return errorResponse('MISSING_QUERY', '缺少搜索关键词参数 q', 400, {
      hint: '示例: /api/agent/search?q=AAPL 或 /api/agent/search?q=腾讯',
    });
  }

  const apiUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;

  try {
    const yfResponse = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (!yfResponse.ok) {
      return errorResponse(
        'UPSTREAM_SEARCH_FAILED',
        `上游搜索服务响应错误 (HTTP ${yfResponse.status})`,
        502
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
        currency: q.currency ?? '',
        matchScore: q.score ?? 0,
      }));

    return successResponse({
      items: results,
      count: results.length,
    }, { query });
  } catch (error) {
    console.error('[agent:search]', error);
    return errorResponse(
      'UPSTREAM_SEARCH_FAILED',
      '上游搜索服务请求失败，请稍后重试',
      502
    );
  }
}
