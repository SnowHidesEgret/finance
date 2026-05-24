/**
 * StockVault — 全局常量定义
 */

/** 市场定义 */
export const MARKETS = {
  A_SHARE: {
    id: 'A_SHARE',
    label: 'A 股',
    flag: '🇨🇳',
    currency: 'CNY',
    color: 'var(--color-market-cn)',
    exchanges: [
      { suffix: '.SHH', name: '上海证券交易所' },
      { suffix: '.SHZ', name: '深圳证券交易所' }
    ]
  },
  HK: {
    id: 'HK',
    label: '港股',
    flag: '🇭🇰',
    currency: 'HKD',
    color: 'var(--color-market-hk)',
    exchanges: [{ suffix: '.HKG', name: '香港联交所' }]
  },
  US: {
    id: 'US',
    label: '美股',
    flag: '🇺🇸',
    currency: 'USD',
    color: 'var(--color-market-us)',
    exchanges: [{ suffix: '', name: 'NYSE / NASDAQ' }]
  },
  SWISS: {
    id: 'SWISS',
    label: '瑞士',
    flag: '🇨🇭',
    currency: 'CHF',
    color: 'var(--color-market-ch)',
    exchanges: [{ suffix: '.SWX', name: 'SIX 瑞士交易所' }]
  }
};

/** 市场 ID 列表 */
export const MARKET_IDS = Object.keys(MARKETS);

/** 货币定义 */
export const CURRENCIES = {
  CNY: { symbol: '¥', name: '人民币', locale: 'zh-CN' },
  USD: { symbol: '$', name: '美元', locale: 'en-US' },
  HKD: { symbol: 'HK$', name: '港币', locale: 'zh-HK' },
  CHF: { symbol: 'CHF', name: '瑞士法郎', locale: 'de-CH' }
};

/** 货币到市场的映射 */
export const CURRENCY_TO_MARKET = {
  CNY: 'A_SHARE',
  HKD: 'HK',
  USD: 'US',
  CHF: 'SWISS'
};

/** 行业分类 */
export const SECTORS = {
  TECHNOLOGY: { label: '科技', icon: '💻' },
  FINANCE: { label: '金融', icon: '🏦' },
  HEALTHCARE: { label: '医疗', icon: '🏥' },
  CONSUMER: { label: '消费', icon: '🛒' },
  ENERGY: { label: '能源', icon: '⚡' },
  MATERIALS: { label: '材料', icon: '🏗️' },
  INDUSTRIAL: { label: '工业', icon: '🏭' },
  REAL_ESTATE: { label: '房地产', icon: '🏠' },
  TELECOM: { label: '通信', icon: '📡' },
  UTILITIES: { label: '公用事业', icon: '💡' },
  CONSUMER_STAPLES: { label: '必需消费', icon: '🍞' },
  OTHER: { label: '其他', icon: '📦' }
};

/** 持仓状态 */
export const POSITION_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
};

/** 交易类型 */
export const TRADE_TYPES = {
  BUY: 'BUY',
  SELL: 'SELL'
};

/** API 端点 */
export const API = {
  STOCK_QUOTE: '/api/stock/quote',
  STOCK_SEARCH: '/api/stock/search',
  POSITIONS: '/api/positions',
  TRADES: '/api/trades',
  TRADES_IMPORT: '/api/trades/import',
  SUMMARY: '/api/summary'
};

/** 汇率 API (Frankfurter — 完全免费、无需 Key) */
export const FRANKFURTER_API = 'https://api.frankfurter.dev/v1';

/** 缓存 TTL */
export const CACHE_TTL = {
  QUOTE: 5 * 60 * 1000,        // 行情缓存 5 分钟
  EXCHANGE_RATE: 2 * 60 * 60 * 1000, // 汇率缓存 2 小时
  SUMMARY: 2 * 60 * 1000       // 汇总缓存 2 分钟
};

/** 页面路由 */
export const ROUTES = {
  DASHBOARD: '/',
  POSITIONS: '/positions',
  TRADE: '/trade',
  CHARTS: '/charts',
  MARKET: '/market',
  TRADES: '/trades',
  IMPORT_EXPORT: '/import-export',
  SETTINGS: '/settings'
};

/** 颜色方案 */
export const COLOR_SCHEMES = {
  CN: 'cn',     // 红涨绿跌 (默认)
  INTL: 'intl'  // 绿涨红跌
};

/** 默认设置 */
export const DEFAULT_SETTINGS = {
  colorScheme: COLOR_SCHEMES.CN,
  theme: 'dark',
  refreshInterval: 60000, // 1 分钟
  language: 'zh-CN'
};
