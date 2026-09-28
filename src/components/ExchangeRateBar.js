/**
 * StockVault — 汇率实时展示条
 */

import { getFormattedRates, getLastUpdated, getExchangeRates } from '../services/exchangeRate.js';
import { formatDate } from '../utils/format.js';
import { getQuotes } from '../services/stockApi.js';

/** @type {number|null} */
let refreshTimer = null;

/**
 * 渲染汇率条
 * @param {HTMLElement} container
 */
export async function renderExchangeRateBar(container) {
  container.innerHTML = `
    <div class="exchange-rate-bar">
      <div class="exchange-rate-bar__rates" id="rate-display">
        <span class="exchange-rate-bar__loading">汇率加载中...</span>
      </div>
      <div class="exchange-rate-bar__meta">
        <span class="exchange-rate-bar__time" id="rate-time"></span>
        <button class="exchange-rate-bar__refresh btn btn--ghost btn--sm" id="rate-refresh" title="刷新汇率">
          ↻
        </button>
      </div>
    </div>
  `;
  
  // 初始加载
  await updateRates();
  
  // 2 小时自动刷新
  refreshTimer = setInterval(updateRates, 2 * 60 * 60 * 1000);
  
  // 手动刷新
  container.querySelector('#rate-refresh')?.addEventListener('click', async () => {
    const btn = container.querySelector('#rate-refresh');
    if (btn) {
      btn.classList.add('spinning');
      await updateRates(true);
      setTimeout(() => btn.classList.remove('spinning'), 500);
    }
  });
}

/**
 * 更新汇率显示
 * @param {boolean} [force=false]
 */
async function updateRates(force = false) {
  try {
    if (force) {
      await getExchangeRates(true);
    }
    
    const [rates, quotes] = await Promise.all([
      getFormattedRates(),
      getQuotes(['DX-Y.NYB', '^TNX'], force).catch(() => new Map()) // 即使获取失败也不影响主体汇率显示
    ]);
    
    const dxyQuote = quotes.get('DX-Y.NYB');
    if (dxyQuote && dxyQuote.price) {
      rates.push({
        pair: '美元指数',
        rate: dxyQuote.price,
        display: `美元指数 ${dxyQuote.price.toFixed(2)}`
      });
    } else {
      rates.push({
        pair: '美元指数',
        rate: null,
        display: '美元指数 ----'
      });
    }

    const tnxQuote = quotes.get('^TNX');
    if (tnxQuote && tnxQuote.price !== null && tnxQuote.price !== undefined) {
      const yieldRate = tnxQuote.price > 20 ? tnxQuote.price / 10 : tnxQuote.price;
      rates.push({
        pair: '10年期美债',
        rate: yieldRate,
        formattedValue: `${yieldRate.toFixed(2)}%`,
        display: `10年期美债 ${yieldRate.toFixed(2)}%`
      });
    } else {
      rates.push({
        pair: '10年期美债',
        rate: null,
        formattedValue: '----',
        display: '10年期美债 ----'
      });
    }

    const display = document.getElementById('rate-display');
    const timeEl = document.getElementById('rate-time');
    
    if (display) {
      display.innerHTML = rates.map(r => {
        const val = r.formattedValue
          ? r.formattedValue
          : (r.rate === null || r.rate === undefined)
            ? '----'
            : r.rate.toFixed(r.pair === '美元指数' ? 2 : 4);
        return `
          <span class="exchange-rate-bar__item">
            <span class="exchange-rate-bar__pair">${r.pair}</span>
            <span class="exchange-rate-bar__value">${val}</span>
          </span>
        `;
      }).join('<span class="exchange-rate-bar__divider">│</span>');
    }
    
    if (timeEl) {
      const lastUpdated = getLastUpdated();
      timeEl.textContent = lastUpdated
        ? `更新于 ${formatDate(new Date(lastUpdated), 'YYYY-MM-DD HH:mm')}`
        : '';
    }
  } catch (error) {
    console.error('[ExchangeRateBar] Failed to update:', error);
  }
}

/**
 * 清理定时器
 */
export function destroyExchangeRateBar() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
