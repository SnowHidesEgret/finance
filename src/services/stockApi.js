/**
 * StockVault — 股票行情服务
 * 通过 Cloudflare Functions 代理调用多数据源行情接口
 */

import { get } from './api.js';
import { API, CACHE_TTL } from '../utils/constants.js';
import { Toast } from '../utils/toast.js';

/** 内存行情缓存 */
const quoteCache = new Map();

/**
 * 获取单只股票行情
 * @param {string} symbol - 股票代码（含交易所后缀）
 * @param {boolean} [forceRefresh=false]
 * @param {Object} [options={}] - { silent?: boolean }
 * @returns {Promise<Object|null>} 行情数据
 */
export async function getQuote(symbol, forceRefresh = false, options = {}) {
  const { silent = false } = options;

  if (!localStorage.getItem('auth_token')) {
    return null;
  }

  // 检查内存缓存
  if (!forceRefresh) {
    const cached = quoteCache.get(symbol);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL.QUOTE)) {
      return cached.data;
    }
  }

  try {
    // 传入 silent: true 避免 api.js 与此处重复弹出两次 Toast
    const params = forceRefresh ? { symbol, force: 1 } : { symbol };
    const data = await get(API.STOCK_QUOTE, params, { silent: true });

    if (data) {
      quoteCache.set(symbol, { data, timestamp: Date.now() });
    }

    return data;
  } catch (error) {
    if (error?.status === 401) {
      return null;
    }

    console.error(`[StockAPI] Failed to fetch quote for ${symbol}:`, error);

    // 降级到缓存（即使过期）
    const stale = quoteCache.get(symbol);
    if (stale) {
      console.warn(`[StockAPI] Using stale cache for ${symbol}`);
      if (!silent) {
        Toast.warning(`行情数据获取失败，正在使用 "${symbol}" 的过期缓存。`);
      }
      return stale.data;
    }

    if (!silent) {
      Toast.error(`无法获取 "${symbol}" 的行情数据，请检查网络或该资产是否受支持。`, '行情获取失败');
    }
    return null;
  }
}

/**
 * 批量获取多只股票行情（优先走后端批量并发接口）
 * @param {string[]} symbols
 * @param {boolean} [forceRefresh=false]
 * @param {Object} [options={}] - { silent?: boolean }
 * @returns {Promise<Map<string, Object>>}
 */
export async function getQuotes(symbols, forceRefresh = false, options = {}) {
  const { silent = false } = options;
  const results = new Map();

  if (!symbols || symbols.length === 0 || !localStorage.getItem('auth_token')) {
    return results;
  }

  // 分离缓存命中和需要请求的
  const toFetch = [];
  for (const symbol of symbols) {
    if (!forceRefresh) {
      const cached = quoteCache.get(symbol);
      if (cached && (Date.now() - cached.timestamp < CACHE_TTL.QUOTE)) {
        results.set(symbol, cached.data);
        continue;
      }
    }
    toFetch.push(symbol);
  }

  if (toFetch.length === 0) {
    return results;
  }

  try {
    const params = {
      symbols: toFetch.join(','),
      ...(forceRefresh ? { force: 1 } : {}),
    };
    const batchData = await get(API.STOCK_QUOTE, params, { silent: true });

    if (batchData && typeof batchData === 'object') {
      const now = Date.now();
      for (const symbol of toFetch) {
        const q = batchData[symbol] || batchData[symbol.toUpperCase()];
        if (q) {
          quoteCache.set(symbol, { data: q, timestamp: now });
          results.set(symbol, q);
        } else {
          const stale = quoteCache.get(symbol);
          if (stale) results.set(symbol, stale.data);
        }
      }
      return results;
    }
  } catch (error) {
    if (error?.status === 401) {
      return results;
    }
    console.warn('[StockAPI] Batch quote endpoint failed, falling back to cached/single:', error);
    // 降级使用本地已有的过期缓存
    for (const symbol of toFetch) {
      const stale = quoteCache.get(symbol);
      if (stale) {
        results.set(symbol, stale.data);
      }
    }
    if (!silent && results.size === 0) {
      Toast.error('部分行情数据获取失败，请稍后重试。', '行情获取异常');
    }
  }

  return results;
}

/**
 * 搜索股票
 * @param {string} query - 搜索关键词（代码或名称）
 * @returns {Promise<Array<{symbol: string, name: string, type: string, region: string, currency: string}>>}
 */
export async function searchStock(query) {
  if (!query || query.trim().length < 1) return [];

  try {
    const data = await get(API.STOCK_SEARCH, { q: query.trim() }, { silent: true });
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`[StockAPI] Search failed for "${query}":`, error);
    return [];
  }
}

/**
 * 刷新所有持仓的行情
 * @param {string[]} symbols - 持仓股票代码列表
 * @param {Function} [onProgress] - 进度回调 (current, total)
 * @param {Object} [options={}] - { silent?: boolean }
 * @returns {Promise<Map<string, Object>>}
 */
export async function refreshAllQuotes(symbols, onProgress, options = {}) {
  const results = await getQuotes(symbols, true, options);
  if (onProgress) {
    onProgress(symbols.length, symbols.length);
  }
  return results;
}

/**
 * 获取缓存中的行情
 * @param {string} symbol
 * @returns {Object|null}
 */
export function getCachedQuote(symbol) {
  const cached = quoteCache.get(symbol);
  return cached ? cached.data : null;
}

/**
 * 清除行情缓存
 */
export function clearQuoteCache() {
  quoteCache.clear();
}
