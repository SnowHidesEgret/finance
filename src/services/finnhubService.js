/**
 * StockVault — Finnhub 数据服务层
 * 封装对 /api/stock/finnhub 代理端点的调用
 */

import { get } from './api.js';
import { API, CACHE_TTL } from '../utils/constants.js';

/** 前端内存缓存 */
const memCache = new Map();

/**
 * 通用 Finnhub 数据获取（带内存缓存）
 * @param {string} type - 数据类型
 * @param {string} symbol - 股票代码
 * @param {number} ttl - 缓存 TTL (ms)
 * @returns {Promise<any>}
 */
async function fetchFinnhub(type, symbol, ttl) {
  const key = `${type}:${symbol}`;
  
  // 检查内存缓存
  const cached = memCache.get(key);
  if (cached && (Date.now() - cached.timestamp < ttl)) {
    return cached.data;
  }
  
  try {
    const result = await get(API.STOCK_FINNHUB, { type, symbol });
    
    if (result === null || result === undefined) return null;
    
    // 处理 no_api_key 错误
    if (result && result.error === 'no_api_key') {
      return { _noApiKey: true, message: result.message };
    }
    
    memCache.set(key, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    // 捕获 API.js 抛出的 no_api_key 异常
    if (error.data && error.data.error === 'no_api_key') {
      return { _noApiKey: true, message: error.data.message };
    }
    console.error(`[FinnhubService] Failed to fetch ${type} for ${symbol}:`, error);
    // 返回过期缓存
    if (cached) return cached.data;
    return null;
  }
}



/**
 * 获取基本面指标
 * @param {string} symbol
 * @returns {Promise<Object|null>}
 */
export async function getBasicFinancials(symbol) {
  const data = await fetchFinnhub('basic-financials', symbol, CACHE_TTL.FINNHUB_FINANCIALS);
  if (!data || data._noApiKey) return data;
  return data;
}

/**
 * 获取财报日历
 * @param {string} symbol
 * @returns {Promise<Array>}
 */
export async function getEarningsCalendar(symbol) {
  const data = await fetchFinnhub('earnings', symbol, CACHE_TTL.FINNHUB_EARNINGS);
  if (!data || data._noApiKey) return data;
  return Array.isArray(data) ? data : [];
}

/**
 * 批量获取多只持仓的 Finnhub 数据
 * @param {string[]} symbols - 美股代码列表
 * @param {Function} [onProgress] - 进度回调 (current, total, symbol)
 * @returns {Promise<Object>} { news, recommendations, priceTargets, financials, earnings }
 */
export async function batchFetchFinnhubData(symbols, onProgress) {
  const result = {
    financials: new Map(),
    earnings: [],
    noApiKey: false,
  };
  
  if (!symbols || symbols.length === 0) return result;
  
  const total = symbols.length;
  
  for (let i = 0; i < total; i++) {
    const symbol = symbols[i];
    if (onProgress) onProgress(i + 1, total, symbol);
    
    // Fetch all data types for this symbol concurrently
    const [finData, earningsData] = await Promise.all([
      getBasicFinancials(symbol),
      getEarningsCalendar(symbol),
    ]);
    
    // Check for noApiKey from any response
    if (finData?._noApiKey) {
      result.noApiKey = true;
      return result;
    }
    

    // Basic financials
    if (finData && !finData._noApiKey) {
      result.financials.set(symbol, finData);
    }
    
    // Earnings
    if (Array.isArray(earningsData)) {
      earningsData.forEach(e => {
        e._symbol = symbol;
        result.earnings.push(e);
      });
    }
    
    // Throttle: 300ms between symbols to stay within 60 req/min
    if (i < total - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  

  // Sort earnings by date ascending
  result.earnings.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  
  return result;
}

/**
 * 清除 Finnhub 内存缓存
 */
export function clearFinnhubCache() {
  memCache.clear();
}
