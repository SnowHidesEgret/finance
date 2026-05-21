/**
 * StockVault — 中央状态管理 (发布-订阅模式)
 */

/**
 * 创建响应式 Store
 * @param {Object} initialState
 * @returns {Object} store instance
 */
export function createStore(initialState = {}) {
  let state = { ...initialState };
  const listeners = new Map();
  
  return {
    /**
     * 获取完整状态
     * @returns {Object}
     */
    getState() {
      return { ...state };
    },
    
    /**
     * 获取指定字段
     * @param {string} key
     * @returns {*}
     */
    get(key) {
      return state[key];
    },
    
    /**
     * 更新状态
     * @param {Object} updates - 要更新的字段
     */
    set(updates) {
      const prevState = { ...state };
      state = { ...state, ...updates };
      
      // 通知特定字段的监听者
      for (const key of Object.keys(updates)) {
        if (prevState[key] !== state[key] && listeners.has(key)) {
          listeners.get(key).forEach(fn => fn(state[key], prevState[key]));
        }
      }
      
      // 通知全局监听者
      if (listeners.has('*')) {
        listeners.get('*').forEach(fn => fn(state, prevState));
      }
    },
    
    /**
     * 监听状态变化
     * @param {string} key - 字段名，'*' 监听所有
     * @param {Function} callback - (newVal, oldVal) => void
     * @returns {Function} 取消监听函数
     */
    on(key, callback) {
      if (!listeners.has(key)) {
        listeners.set(key, new Set());
      }
      listeners.get(key).add(callback);
      
      return () => {
        listeners.get(key)?.delete(callback);
      };
    },
    
    /**
     * 重置状态
     * @param {Object} [newState]
     */
    reset(newState) {
      state = newState || { ...initialState };
      if (listeners.has('*')) {
        listeners.get('*').forEach(fn => fn(state, {}));
      }
    }
  };
}

// ─── 全局 Store 实例 ───

/** 持仓数据 Store */
export const positionsStore = createStore({
  positions: [],          // 所有持仓
  openPositions: [],      // 持仓中
  closedPositions: [],    // 已平仓
  loading: false,
  error: null,
  lastFetched: null
});

/** 行情数据 Store */
export const marketStore = createStore({
  quotes: {},             // { symbol: quoteData }
  exchangeRates: null,    // { USD: x, HKD: x, CHF: x }
  ratesLastUpdated: null,
  quotesLoading: false,
  ratesLoading: false
});

/** 汇总数据 Store */
export const summaryStore = createStore({
  totalValueCNY: 0,
  totalCostCNY: 0,
  totalPnLCNY: 0,
  totalPnLPercent: 0,
  totalDayPnL: 0,
  positionCount: 0,
  marketSummaries: {},
  sectorSummaries: {},
  currencyExposure: {},
  positionDetails: [],
  loading: false
});

/** 设置 Store */
export const settingsStore = createStore({
  colorScheme: 'cn',      // 'cn' | 'intl'
  theme: 'dark',
  refreshInterval: 300000,
  sidebarCollapsed: false
});
