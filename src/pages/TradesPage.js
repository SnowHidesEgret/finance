/**
 * StockVault — 交易记录页
 */

import { formatQuantity } from '../utils/format.js';
import { MARKETS, MARKET_IDS } from '../utils/constants.js';
import { get } from '../services/api.js';

/** 货币 → 前缀符号 */
const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };

/** 格式化本币金额 */
function fmtNative(amount, currency) {
  const sym = CURRENCY_SYMBOL[currency] || '';
  return `${sym}${Number(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function renderTradesPage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">交易记录</h2>
        <div class="page-actions">
          <a href="#/trade" class="btn btn--primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            录入交易
          </a>
        </div>
      </div>

      <div class="card mb-4">
        <div class="filter-bar" style="display:flex; gap:16px; margin-bottom:16px; align-items:center; flex-wrap:wrap;">
          <select id="filter-market" class="select" style="width:150px;">
            <option value="">全部市场</option>
            ${MARKET_IDS.map(id => `<option value="${id}">${MARKETS[id].flag} ${MARKETS[id].label}</option>`).join('')}
          </select>
          <select id="filter-type" class="select" style="width:150px;">
            <option value="">全部类型</option>
            <option value="BUY">买入 (BUY)</option>
            <option value="SELL">卖出 (SELL)</option>
          </select>
          <button id="btn-search" class="btn btn--ghost">查询</button>
        </div>

        <div class="table-wrapper">
          <table class="table" id="trades-table">
            <thead>
              <tr>
                <th class="table__th">交易日期</th>
                <th class="table__th">名称/代码</th>
                <th class="table__th">市场</th>
                <th class="table__th">类型</th>
                <th class="table__th table__th--right">成交价</th>
                <th class="table__th table__th--right">数量</th>
                <th class="table__th table__th--right">总金额</th>
                <th class="table__th table__th--right">手续费</th>
              </tr>
            </thead>
            <tbody id="trades-tbody">
              <tr><td colspan="8" class="table__empty">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  await loadTrades();

  container.querySelector('#btn-search')?.addEventListener('click', loadTrades);
}

async function loadTrades() {
  const tbody = document.getElementById('trades-tbody');
  if (!tbody) return;

  const market = document.getElementById('filter-market')?.value || '';
  const type = document.getElementById('filter-type')?.value || '';

  tbody.innerHTML = `<tr><td colspan="8" class="table__empty">加载中...</td></tr>`;

  try {
    const params = {};
    if (market) params.market = market;

    // TODO: The backend doesn't support trade_type filter natively yet, but we can filter it client-side for now or implement it.
    // The index.js for trades does not seem to have trade_type in binds. Let's filter client-side for simplicity if it's small, 
    // or just fetch all and filter.
    
    const response = await get('/api/trades', params);
    let trades = Array.isArray(response) ? response : [];
    
    if (type) {
        trades = trades.filter(t => t.trade_type === type);
    }

    if (trades.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="8" class="table__empty">
          <div class="empty-state">
            <div class="empty-state__icon"><i data-lucide="inbox" style="width: 48px; height: 48px; stroke-width: 1.5;"></i></div>
            <p class="empty-state__text">暂无交易记录</p>
          </div>
        </td></tr>`;
      return;
    }

    tbody.innerHTML = trades.map(trade => {
      const m = MARKETS[trade.market] || {};
      const currency = trade.currency || (m.currency || 'CNY');
      const isBuy = trade.trade_type === 'BUY';
      
      const typeLabel = isBuy ? '买入' : '卖出';
      const typeColor = isBuy ? '#ef4444' : '#10b981'; // Red for buy, Green for sell (common in CN)
      const typeBg = isBuy ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';

      const totalValue = trade.price * trade.quantity;

      return `
        <tr class="table__row table__row--hoverable">
          <td class="table__td table__td--mono">${trade.trade_date}</td>
          <td class="table__td">
            <div style="font-weight:600">${trade.name}</div>
            <div style="font-size:0.75rem;color:var(--color-text-secondary);font-family:monospace">${trade.symbol}</div>
          </td>
          <td class="table__td" title="${m.label || trade.market}">
            ${m.flag || ''}
          </td>
          <td class="table__td">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:bold;color:${typeColor};background:${typeBg};white-space:nowrap;">
              ${typeLabel}
            </span>
          </td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(trade.price, currency)}</td>
          <td class="table__td table__td--right">${formatQuantity(trade.quantity)}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(totalValue, currency)}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(trade.commission, currency)}</td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error('Failed to load trades', error);
    tbody.innerHTML = `<tr><td colspan="8" class="table__empty">加载失败: ${error.message}</td></tr>`;
  }
}
