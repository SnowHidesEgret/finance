/**
 * StockVault — 持仓管理页
 * 所有金额按持仓本币计价（港股=HKD, 美股=USD, A股=CNY, 瑞士=CHF）
 * 仪表盘汇总才换算人民币
 */

import { formatPercent, formatQuantity, getPnLClass } from '../utils/format.js';
import { MARKETS, MARKET_IDS } from '../utils/constants.js';
import { get } from '../services/api.js';

/** 货币 → 前缀符号 */
const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };

/** 格式化本币金额 */
function fmtNative(amount, currency, showSign = false) {
  const sym = CURRENCY_SYMBOL[currency] || '';
  const sign = showSign && amount > 0 ? '+' : '';
  return `${sign}${sym}${Number(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 根据 market 推断本币 */
function marketCurrency(market) {
  return MARKETS[market]?.currency || 'CNY';
}

export async function renderPositionsPage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">持仓管理</h2>
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
                <th class="table__th table__th--right">总成本</th>
                <th class="table__th table__th--right">当前市值</th>
                <th class="table__th table__th--right">浮动盈亏</th>
                <th class="table__th table__th--right">收益率</th>
                <th class="table__th table__th--right">状态</th>
              </tr>
            </thead>
            <tbody id="full-positions-tbody">
              <tr><td colspan="10" class="table__empty">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  await loadPositions();

  container.querySelector('#btn-search')?.addEventListener('click', loadPositions);

  // 监听全局刷新
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

  const market = document.getElementById('filter-market')?.value || '';
  const status = document.getElementById('filter-status')?.value || 'OPEN';

  tbody.innerHTML = `<tr><td colspan="10" class="table__empty">加载中...</td></tr>`;

  try {
    const params = {};
    if (market) params.market = market;
    if (status) params.status = status;

    // 并行获取：原始持仓列表 + 含实时价格的 summary
    const [rawPositions, summary] = await Promise.all([
      get('/api/positions', params),
      get('/api/summary').catch(() => null),
    ]);

    const positions = Array.isArray(rawPositions) ? rawPositions : [];

    if (positions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="table__empty">暂无数据</td></tr>`;
      return;
    }

    // 用 summary 中的实时价格建立 symbol → liveData 映射
    const liveMap = new Map();
    if (summary?.positions) {
      for (const p of summary.positions) {
        liveMap.set(p.symbol?.toUpperCase(), p);
      }
    }

    // 更新行情时间戳
    const timeEl = document.getElementById('price-update-time');
    if (timeEl) {
      const hasLive = [...liveMap.values()].some(p => p.hasLivePrice);
      timeEl.textContent = hasLive
        ? `⏱ 行情: ${new Date().toLocaleTimeString('zh-CN')}`
        : '⚠ 行情获取失败，显示成本价';
      timeEl.style.color = hasLive ? 'var(--color-text-muted)' : 'var(--color-warn, #f59e0b)';
    }

    tbody.innerHTML = positions.map(pos => {
      const isClosed = pos.status === 'CLOSED';
      const m = MARKETS[pos.market] || {};

      // ── 本币 ──────────────────────────────────────────────
      const currency = pos.currency || marketCurrency(pos.market);
      const live     = liveMap.get(pos.symbol?.toUpperCase());

      // 现价（本币）
      const currentPrice = isClosed
        ? (pos.close_price ?? pos.open_price)
        : (live?.currentPrice ?? pos.open_price);
      const hasLivePrice = !isClosed && live?.hasLivePrice;

      // 成本 = 开仓均价 × 数量 + 手续费（全部本币）
      const costOriginal  = pos.open_price * pos.quantity + (pos.commission ?? 0);
      // 市值 = 现价 × 数量（本币）
      const valueOriginal = currentPrice * pos.quantity;
      // 盈亏（本币）
      const pnlOriginal   = valueOriginal - costOriginal;
      // 收益率
      const pnlPct        = costOriginal > 0 ? (pnlOriginal / costOriginal) * 100 : 0;

      // 现价显示（带"实时/估算"标注）
      const priceCell = hasLivePrice
        ? `<span>${fmtNative(currentPrice, currency)}</span>`
        : `<span style="color:var(--color-text-muted)" title="使用开仓价估算">${fmtNative(currentPrice, currency)} <small style="font-size:0.65rem">*</small></span>`;

      return `
        <tr class="table__row table__row--hoverable">
          <td class="table__td">
            <div style="font-weight:600">${pos.name}</div>
            <div style="font-size:0.75rem;color:var(--color-text-secondary);font-family:monospace">${pos.symbol}</div>
          </td>
          <td class="table__td">
            <span class="tag tag--${pos.market?.toLowerCase()}">${m.flag || ''} ${m.label || pos.market}</span>
          </td>
          <td class="table__td table__td--right">${formatQuantity(pos.quantity)}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(pos.open_price, currency)}</td>
          <td class="table__td table__td--right table__td--mono">${priceCell}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(costOriginal, currency)}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(valueOriginal, currency)}</td>
          <td class="table__td table__td--right table__td--mono table__td--${getPnLClass(pnlOriginal)}">
            ${fmtNative(pnlOriginal, currency, true)}
          </td>
          <td class="table__td table__td--right table__td--${getPnLClass(pnlPct)}">
            ${formatPercent(pnlPct)}
          </td>
          <td class="table__td table__td--right">
            <span class="tag" style="background:${isClosed ? '#374151' : '#065f46'}">
              ${isClosed ? '已平仓' : '持仓中'}
            </span>
          </td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error('Failed to load positions', error);
    tbody.innerHTML = `<tr><td colspan="10" class="table__empty">加载失败: ${error.message}</td></tr>`;
  }
}
