/**
 * StockVault — 持仓管理页
 * 显示实时价格（via /api/summary）和正确的多货币成本/市值
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
        <div class="filter-bar" style="display:flex; gap:16px; margin-bottom:16px; align-items:center;">
          <select id="filter-market" class="select" style="width:150px;">
            <option value="">全部市场</option>
            ${MARKET_IDS.map(id => `<option value="${id}">${MARKETS[id].flag} ${MARKETS[id].label}</option>`).join('')}
          </select>
          <select id="filter-status" class="select" style="width:150px;">
            <option value="OPEN">持仓中</option>
            <option value="CLOSED">已平仓</option>
            <option value="">全部状态</option>
          </select>
          <button id="btn-search" class="btn btn--ghost">查询</button>
          <span id="price-update-time" style="margin-left:auto;font-size:0.75rem;color:var(--color-text-muted)"></span>
        </div>
        
        <div class="table-wrapper">
          <table class="table" id="full-positions-table">
            <thead>
              <tr>
                <th class="table__th">名称/代码</th>
                <th class="table__th">市场</th>
                <th class="table__th table__th--right">数量</th>
                <th class="table__th table__th--right">开仓均价</th>
                <th class="table__th table__th--right">现价</th>
                <th class="table__th table__th--right">总成本(原币)</th>
                <th class="table__th table__th--right">市值(原币)</th>
                <th class="table__th table__th--right">市值(¥)</th>
                <th class="table__th table__th--right">盈亏(¥)</th>
                <th class="table__th table__th--right">收益率</th>
                <th class="table__th table__th--right">状态</th>
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

  // Listen to global refresh
  const refreshHandler = () => loadPositions();
  window.addEventListener('stockvault:refresh', refreshHandler);
  const observer = new MutationObserver(() => {
    if (!document.getElementById('full-positions-table')) {
      window.removeEventListener('stockvault:refresh', refreshHandler);
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });
}

async function loadPositions() {
  const tbody = document.getElementById('full-positions-tbody');
  if (!tbody) return;
  
  const market = document.getElementById('filter-market')?.value;
  const status = document.getElementById('filter-status')?.value;
  
  tbody.innerHTML = `<tr><td colspan="11" class="table__empty">加载中...</td></tr>`;
  
  try {
    // Fetch both raw positions and summary (with live prices + exchange rates)
    const [rawPositions, summary] = await Promise.all([
      get('/api/positions', Object.fromEntries(
        [market && ['market', market], status && ['status', status]].filter(Boolean)
      )),
      get('/api/summary').catch(() => null),
    ]);

    const positions = Array.isArray(rawPositions) ? rawPositions : [];
    
    if (positions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="table__empty">暂无数据</td></tr>`;
      return;
    }

    // Build a map of symbol → live position data from summary
    const liveMap = new Map();
    if (summary?.positions) {
      for (const p of summary.positions) {
        liveMap.set(p.symbol?.toUpperCase(), p);
      }
    }
    const rates = summary?.exchangeRates || { USD: 0.1389, HKD: 1.0833, CHF: 0.1234 };

    function toCNY(amount, currency) {
      if (!currency || currency === 'CNY') return amount;
      const r = rates[currency];
      return r ? amount / r : amount;
    }

    // Update price time label
    const timeEl = document.getElementById('price-update-time');
    if (timeEl) {
      const hasLive = [...liveMap.values()].some(p => p.hasLivePrice);
      timeEl.textContent = hasLive ? `行情更新: ${new Date().toLocaleTimeString('zh-CN')}` : '⚠ 使用成本价（行情未获取）';
    }

    tbody.innerHTML = positions.map(pos => {
      const isClosed = pos.status === 'CLOSED';
      const m = MARKETS[pos.market] || {};
      const live = liveMap.get(pos.symbol?.toUpperCase());

      // Currency of this position
      const currency = pos.currency || (pos.market === 'US' ? 'USD' : pos.market === 'HK' ? 'HKD' : pos.market === 'SWISS' ? 'CHF' : 'CNY');
      const currencySymbol = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF' }[currency] || '';

      // Price
      const currentPrice = isClosed
        ? (pos.close_price || pos.open_price)
        : (live?.currentPrice ?? pos.open_price);
      const hasLivePrice = !isClosed && live?.hasLivePrice;

      // Cost in original currency
      const costOriginal = pos.open_price * pos.quantity + (pos.commission ?? 0);
      const valueOriginal = currentPrice * pos.quantity;

      // PnL in CNY
      const rateToCNY = currency === 'CNY' ? 1 : (rates[currency] ? 1 / rates[currency] : 1);
      const valueCNY = live?.marketValueCNY ?? toCNY(valueOriginal, currency);
      const costCNY  = live?.costCNY ?? toCNY(costOriginal, currency);
      const pnlCNY   = live?.pnlCNY ?? (valueCNY - costCNY);
      const pnlPct   = live?.pnlPercent ?? (costCNY > 0 ? (pnlCNY / costCNY) * 100 : 0);

      const priceLabel = hasLivePrice
        ? `<span style="color:var(--color-text-primary)">${currencySymbol}${currentPrice.toFixed(2)}</span>`
        : `<span style="color:var(--color-text-muted)" title="使用开仓价">${currencySymbol}${currentPrice.toFixed(2)} <small>*</small></span>`;

      return `
        <tr class="table__row table__row--hoverable">
          <td class="table__td">
            <div style="font-weight:600">${pos.name}</div>
            <div style="font-size:0.75rem;color:var(--color-text-secondary);font-family:monospace">${pos.symbol}</div>
          </td>
          <td class="table__td"><span class="tag tag--${pos.market?.toLowerCase()}">${m.flag || ''} ${m.label || pos.market}</span></td>
          <td class="table__td table__td--right">${formatQuantity(pos.quantity)}</td>
          <td class="table__td table__td--right table__td--mono">${currencySymbol}${Number(pos.open_price).toFixed(2)}</td>
          <td class="table__td table__td--right table__td--mono">${priceLabel}</td>
          <td class="table__td table__td--right table__td--mono">${currencySymbol}${costOriginal.toFixed(2)}</td>
          <td class="table__td table__td--right table__td--mono">${currencySymbol}${valueOriginal.toFixed(2)}</td>
          <td class="table__td table__td--right table__td--mono">${formatCurrency(valueCNY)}</td>
          <td class="table__td table__td--right table__td--${getPnLClass(pnlCNY)}">${formatCurrency(pnlCNY, 'CNY', true)}</td>
          <td class="table__td table__td--right table__td--${getPnLClass(pnlPct)}">${formatPercent(pnlPct)}</td>
          <td class="table__td table__td--right">
            <span class="tag" style="background:${isClosed ? '#374151' : '#065f46'}">${isClosed ? '已平仓' : '持仓中'}</span>
          </td>
        </tr>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Failed to load positions', error);
    tbody.innerHTML = `<tr><td colspan="11" class="table__empty">加载失败: ${error.message}</td></tr>`;
  }
}
