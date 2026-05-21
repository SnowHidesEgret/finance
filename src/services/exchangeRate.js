/**
 * StockVault — 汇率服务
 * 使用 Frankfurter API（完全免费、无需 Key、CORS 友好）
 */

import { FRANKFURTER_API, CACHE_TTL, CURRENCIES } from '../utils/constants.js';

const CACHE_KEY = 'stockvault_exchange_rates';

/** @type {{ rates: Object, lastUpdated: number } | null} */
let rateCache = null;

/**
 * 获取当前汇率（CNY 为基准）
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<Object>} { USD: 0.1389, HKD: 1.0833, CHF: 0.1234, CNY: 1 }
 */
export async function getExchangeRates(forceRefresh = false) {
  // 检查内存缓存
  if (!forceRefresh && rateCache && (Date.now() - rateCache.lastUpdated < CACHE_TTL.EXCHANGE_RATE)) {
    return rateCache.rates;
  }
  
  // 检查 localStorage 缓存
  if (!forceRefresh) {
    const stored = loadFromStorage();
    if (stored) {
      rateCache = stored;
      return stored.rates;
    }
  }
  
  // 调用 Frankfurter API
  try {
    // Frankfurter uses CNY as base, get rates to USD, HKD, CHF
    const response = await fetch(
      `${FRANKFURTER_API}/latest?base=CNY&symbols=USD,HKD,CHF`
    );
    
    if (!response.ok) {
      throw new Error(`Frankfurter API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const rates = {
      CNY: 1,
      USD: data.rates.USD,
      HKD: data.rates.HKD,
      CHF: data.rates.CHF
    };
    
    // 更新缓存
    rateCache = { rates, lastUpdated: Date.now() };
    saveToStorage(rateCache);
    
    console.log('[ExchangeRate] Rates updated:', rates);
    return rates;
  } catch (error) {
    console.error('[ExchangeRate] Failed to fetch rates:', error);
    
    // 降级到缓存
    const stored = loadFromStorage();
    if (stored) {
      console.warn('[ExchangeRate] Using stale cached rates');
      return stored.rates;
    }
    
    // 最终降级：使用固定汇率
    return getFallbackRates();
  }
}

/**
 * 货币转换：从 source 转换到 CNY
 * @param {number} amount - 原始金额
 * @param {string} fromCurrency - 原始货币 (USD, HKD, CHF, CNY)
 * @param {Object} [rates] - 汇率对象（可选，默认获取最新）
 * @returns {Promise<number>} CNY 金额
 */
export async function convertToCNY(amount, fromCurrency, rates) {
  if (fromCurrency === 'CNY') return amount;
  
  const r = rates || await getExchangeRates();
  // rates 是以 CNY 为基准的，所以 1 CNY = r[USD] USD
  // 要将 USD 转 CNY：amount / r[USD]
  const rate = r[fromCurrency];
  if (!rate) {
    console.error(`[ExchangeRate] Unknown currency: ${fromCurrency}`);
    return amount;
  }
  
  return amount / rate;
}

/**
 * 获取某货币到 CNY 的汇率
 * @param {string} currency
 * @param {Object} [rates]
 * @returns {Promise<number>} 1 单位该货币 = ? CNY
 */
export async function getRateToCNY(currency, rates) {
  if (currency === 'CNY') return 1;
  
  const r = rates || await getExchangeRates();
  const rate = r[currency];
  if (!rate) return 1;
  
  // 1 CNY = rate 个 foreign currency
  // 所以 1 foreign currency = 1/rate CNY
  return 1 / rate;
}

/**
 * 获取格式化的汇率显示文本
 * @returns {Promise<Array<{pair: string, rate: number, display: string}>>}
 */
export async function getFormattedRates() {
  const rates = await getExchangeRates();
  
  return [
    {
      pair: 'USD/CNY',
      rate: 1 / rates.USD,
      display: `USD/CNY ${(1 / rates.USD).toFixed(4)}`
    },
    {
      pair: 'HKD/CNY',
      rate: 1 / rates.HKD,
      display: `HKD/CNY ${(1 / rates.HKD).toFixed(4)}`
    },
    {
      pair: 'CHF/CNY',
      rate: 1 / rates.CHF,
      display: `CHF/CNY ${(1 / rates.CHF).toFixed(4)}`
    }
  ];
}

/**
 * 获取汇率最后更新时间
 * @returns {number|null} timestamp
 */
export function getLastUpdated() {
  return rateCache?.lastUpdated || null;
}

// ─── 内部工具 ───

function loadFromStorage() {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (!stored) return null;
    
    const data = JSON.parse(stored);
    if (Date.now() - data.lastUpdated < CACHE_TTL.EXCHANGE_RATE) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

function saveToStorage(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[ExchangeRate] Failed to save to localStorage:', e);
  }
}

function getFallbackRates() {
  console.warn('[ExchangeRate] Using fallback rates');
  return {
    CNY: 1,
    USD: 0.1389,
    HKD: 1.0833,
    CHF: 0.1234
  };
}
