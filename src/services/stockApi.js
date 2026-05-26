/**
 * StockVault — 股票行情服务
 * 通过 Cloudflare Functions 代理调用 Yahoo Finance
 */

import { get } from './api.js';
import { API, CACHE_TTL } from '../utils/constants.js';

/** 内存行情缓存 */
const quoteCache = new Map();

/** 请求队列（节流控制） */
let requestQueue = [];
let isProcessing = false;

/**
 * 获取单只股票行情
 * @param {string} symbol - 股票代码（含交易所后缀）
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<Object|null>} 行情数据
 */
export async function getQuote(symbol, forceRefresh = false) {
  // 检查内存缓存
  if (!forceRefresh) {
    const cached = quoteCache.get(symbol);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL.QUOTE)) {
      return cached.data;
    }
  }
  
  try {
    const data = await get(API.STOCK_QUOTE, { symbol });
    
    if (data) {
      quoteCache.set(symbol, { data, timestamp: Date.now() });
    }
    
    return data;
  } catch (error) {
    console.error(`[StockAPI] Failed to fetch quote for ${symbol}:`, error);
    
    // 降级到缓存（即使过期）
    const stale = quoteCache.get(symbol);
    if (stale) {
      console.warn(`[StockAPI] Using stale cache for ${symbol}`);
      return stale.data;
    }
    
    return null;
  }
}

/**
 * 批量获取多只股票行情
 * @param {string[]} symbols
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<Map<string, Object>>}
 */
export async function getQuotes(symbols, forceRefresh = false) {
  const results = new Map();
  
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
  
  // 为防范接口频次限制限制，逐个请求（带间隔）
  for (const symbol of toFetch) {
    try {
      const data = await getQuote(symbol, true);
      if (data) results.set(symbol, data);
    } catch (e) {
      console.error(`[StockAPI] Batch fetch failed for ${symbol}:`, e);
    }
    
    // 请求间隔 1.5 秒，避免触发限流
    if (toFetch.indexOf(symbol) < toFetch.length - 1) {
      await sleep(1500);
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
    const data = await get(API.STOCK_SEARCH, { q: query.trim() });
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
 * @returns {Promise<Map<string, Object>>}
 */
export async function refreshAllQuotes(symbols, onProgress) {
  const results = new Map();
  const total = symbols.length;
  
  for (let i = 0; i < total; i++) {
    const symbol = symbols[i];
    try {
      const data = await getQuote(symbol, true);
      if (data) results.set(symbol, data);
    } catch (e) {
      console.error(`[StockAPI] Refresh failed for ${symbol}:`, e);
    }
    
    if (onProgress) onProgress(i + 1, total);
    
    // 间隔控制
    if (i < total - 1) {
      await sleep(1500);
    }
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

// ─── 工具 ───

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
