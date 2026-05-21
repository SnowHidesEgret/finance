/**
 * StockVault — 持仓管理页
 */

import { formatCurrency, formatPercent, formatQuantity, getPnLClass } from '../utils/format.js';
import { MARKETS, MARKET_IDS } from '../utils/constants.js';
import { get, put } from '../services/api.js';

export async function renderPositionsPage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">持仓管理</h2>
        <div class="page-actions">
          <a href="#/trade" class="btn btn--primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            录入交易
          </a>
        </div>
      </div>
      
      <div class="card mb-4">
        <div class="filter-bar" style="display:flex; gap:16px; margin-bottom:16px;">
          <select id="filter-market" class="select" style="width:150px;">
            <option value="">全部市场</option>
            ${MARKET_IDS.map(id => `<option value="${id}">${MARKETS[id].label}</option>`).join('')}
          </select>
          <select id="filter-status" class="select" style="width:150px;">
            <option value="OPEN">持仓中</option>
            <option value="CLOSED">已平仓</option>
            <option value="">全部状态</option>
          </select>
          <button id="btn-search" class="btn btn--ghost">查询</button>
        </div>
        
        <div class="table-wrapper">
          <table class="table" id="full-positions-table">
            <thead>
              <tr>
                <th class="table__th">名称/代码</th>
                <th class="table__th">市场</th>
                <th class="table__th table__th--right">数量</th>
                <th class="table__th table__th--right">开仓均价</th>
                <th class="table__th table__th--right">现价/平仓价</th>
                <th class="table__th table__th--right">总成本</th>
                <th class="table__th table__th--right">市值/回收</th>
                <th class="table__th table__th--right">盈亏</th>
                <th class="table__th table__th--right">收益率</th>
                <th class="table__th table__th--right">状态</th>
                <th class="table__th table__th--right">操作</th>
              </tr>
            </thead>
            <tbody id="full-positions-tbody">
              <tr><td colspan="11" class="table__empty">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  
  await loadPositions();
  
  container.querySelector('#btn-search')?.addEventListener('click', loadPositions);
}

async function loadPositions() {
  const tbody = document.getElementById('full-positions-tbody');
  if (!tbody) return;
  
  const market = document.getElementById('filter-market')?.value;
  const status = document.getElementById('filter-status')?.value;
  
  tbody.innerHTML = `<tr><td colspan="11" class="table__empty">加载中...</td></tr>`;
  
  try {
    const params = {};
    if (market) params.market = market;
    if (status) params.status = status;
    
    // In real app, we'd fetch prices too, for now just show DB data
    const positions = await get('/api/positions', params);
    
    if (!positions || positions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="table__empty">暂无数据</td></tr>`;
      return;
    }
    
    tbody.innerHTML = positions.map(pos => {
      const isClosed = pos.status === 'CLOSED';
      const m = MARKETS[pos.market] || {};
      const currentPrice = isClosed ? pos.close_price : (pos.open_price); // Fallback
      
      // Basic PnL without live rates for simplicity in this view, 
      // ideally we merge with summary API or live quotes
      const cost = pos.open_price * pos.quantity;
      const value = currentPrice * pos.quantity;
      const pnl = value - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      
      return `
        <tr class="table__row table__row--hoverable">
          <td class="table__td">
            <div style="font-weight:600">${pos.name}</div>
            <div style="font-size:0.75rem;color:var(--color-text-secondary);font-family:monospace">${pos.symbol}</div>
          </td>
          <td class="table__td"><span class="tag tag--${pos.market?.toLowerCase()}">${m.label}</span></td>
          <td class="table__td table__td--right">${formatQuantity(pos.quantity)}</td>
          <td class="table__td table__td--right table__td--mono">${pos.open_price}</td>
          <td class="table__td table__td--right table__td--mono">${currentPrice || '--'}</td>
          <td class="table__td table__td--right table__td--mono">${formatCurrency(cost, pos.currency)}</td>
          <td class="table__td table__td--right table__td--mono">${formatCurrency(value, pos.currency)}</td>
          <td class="table__td table__td--right table__td--${getPnLClass(pnl)}">${formatCurrency(pnl, pos.currency, true)}</td>
          <td class="table__td table__td--right table__td--${getPnLClass(pnlPct)}">${formatPercent(pnlPct)}</td>
          <td class="table__td table__td--right">
            <span class="tag" style="background:${isClosed?'#374151':'#065f46'}">${isClosed?'已平仓':'持仓中'}</span>
          </td>
          <td class="table__td table__td--right">
            ${!isClosed ? `<button class="btn btn--sm btn--ghost" onclick="alert('Close position modal here')">平仓</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Failed to load positions', error);
    tbody.innerHTML = `<tr><td colspan="11" class="table__empty">加载失败</td></tr>`;
  }
}
