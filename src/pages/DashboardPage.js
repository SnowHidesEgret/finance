/**
 * StockVault — 仪表盘页
 * 核心监控页面：KPI 卡片 + 市场概览 + 图表 + 持仓表
 */

import { formatCurrency, formatPercent, formatNumber, getPnLClass, formatQuantity } from '../utils/format.js';
import { MARKETS, MARKET_IDS } from '../utils/constants.js';
import { get } from '../services/api.js';
import { getExchangeRates } from '../services/exchangeRate.js';
import { getQuotes } from '../services/stockApi.js';
import { summaryStore, positionsStore, marketStore } from '../store/index.js';
import { isMarketOpen } from '../utils/marketHours.js';
import { showActiveLotsModal } from './PositionsPage.js';

let currentSortField = 'weight';
let currentSortOrder = 'desc';
let cachedPositions = [];
let cachedMarketSummaries = {};

/**
 * 渲染仪表盘页面
 * @param {HTMLElement} container
 */
export async function renderDashboardPage(container) {
  currentSortField = 'weight';
  currentSortOrder = 'desc';

  container.innerHTML = `
    <div class="dashboard animate-fade-in-up">

      <!-- KPI 指标卡 -->
      <section class="dashboard__kpi-row">
        <div class="kpi-card kpi-card--total animate-fade-in-up delay-1" id="kpi-total-value" style="cursor:pointer;" title="点击查看资产分布">
          <div class="kpi-card__icon">💰</div>
          <div class="kpi-card__content">
            <div class="kpi-card__label">持仓资产 (CNY)</div>
            <div class="kpi-card__value" id="val-total-value">--</div>
            <div class="kpi-card__sparkline" id="sparkline-value"></div>
          </div>
        </div>
        <div class="kpi-card kpi-card--pnl animate-fade-in-up delay-2" id="kpi-total-pnl">
          <div class="kpi-card__icon">📈</div>
          <div class="kpi-card__content">
            <div class="kpi-card__label">总盈亏</div>
            <div class="kpi-card__value" id="val-total-pnl">--</div>
            <div class="kpi-card__sub" id="val-total-pnl-pct">--</div>
          </div>
        </div>
        <div class="kpi-card kpi-card--day animate-fade-in-up delay-3" id="kpi-day-pnl" style="cursor:pointer;" title="点击查看今日盈亏明细">
          <div class="kpi-card__icon">📊</div>
          <div class="kpi-card__content">
            <div class="kpi-card__label">今日盈亏</div>
            <div class="kpi-card__value" id="val-day-pnl">--</div>
            <div class="kpi-card__sub" id="val-day-pnl-pct">--</div>
          </div>
        </div>
        <div class="kpi-card kpi-card--cost animate-fade-in-up delay-4" id="kpi-ytd" style="cursor:pointer;" title="点击查看各市场 YTD 收益明细">
          <div class="kpi-card__icon">📅</div>
          <div class="kpi-card__content">
            <div class="kpi-card__label">YTD 收益率</div>
            <div class="kpi-card__value" id="val-ytd-pct">--</div>
          </div>
        </div>
        <div class="kpi-card kpi-card--return animate-fade-in-up delay-5" id="kpi-return-rates" style="cursor:pointer;" title="点击查看各国市场年化收益率">
          <div class="kpi-card__icon">🎯</div>
          <div class="kpi-card__content">
            <div class="kpi-card__label">年化收益率</div>
            <div class="kpi-card__value" id="val-annualized-return">--</div>
          </div>
        </div>
      </section>

      <!-- 各国市场概览 -->
      <section class="dashboard__section animate-fade-in-up delay-2">
        <h2 class="dashboard__section-title">
          <span class="dashboard__section-icon"><i data-lucide="globe"></i></span>
          各国市场概览
        </h2>
        <div class="dashboard__market-overview" id="market-overview">
          ${MARKET_IDS.map(id => renderMarketCard(id, null)).join('')}
        </div>
      </section>

      <!-- 图表区 -->
      <section class="dashboard__section animate-fade-in-up delay-3">
        <h2 class="dashboard__section-title">
          <span class="dashboard__section-icon"><i data-lucide="line-chart"></i></span>
          投资组合分析
        </h2>
        <div class="dashboard__charts-row">
          <div class="chart-container">
            <div class="chart-container__header">
              <h3 class="chart-container__title">持仓分布</h3>
              <div class="chart-controls">
                <button class="chart-controls__btn chart-controls__btn--active" data-pie-mode="market">按市场</button>
                <button class="chart-controls__btn" data-pie-mode="stock">按个股</button>
              </div>
            </div>
            <div class="chart-container__body" id="chart-pie" style="height:320px"></div>
          </div>
          <div class="chart-container">
            <div class="chart-container__header">
              <h3 class="chart-container__title">盈亏排名</h3>
            </div>
            <div class="chart-container__body" id="chart-pnl-bar" style="height:320px"></div>
          </div>
        </div>
      </section>

      <!-- 持仓速览表 -->
      <section class="dashboard__section animate-fade-in-up delay-4">
        <h2 class="dashboard__section-title">
          <span class="dashboard__section-icon"><i data-lucide="list"></i></span>
          持仓明细
        </h2>
        <div class="table-wrapper" id="positions-table-wrapper">
          <table class="table" id="positions-table">
            <thead>
              <tr>
                <th class="table__th">名称</th>
                <th class="table__th">代码</th>
                <th class="table__th">市场</th>
                <th class="table__th table__th--right">数量</th>
                <th class="table__th table__th--right">现价</th>
                <th class="table__th table__th--right">成本</th>
                <th class="table__th table__th--right">市值(¥)</th>
                <th class="table__th table__th--right dashboard-sortable" data-sort="pnl" style="cursor:pointer; user-select:none;" title="点击按盈亏排序">盈亏(¥) <span class="sort-icon"></span></th>
                <th class="table__th table__th--right">盈亏%</th>
                <th class="table__th table__th--right dashboard-sortable" data-sort="ytd" style="cursor:pointer; user-select:none;" title="YTD收益率">YTD <span class="sort-icon"></span></th>
                <th class="table__th table__th--right dashboard-sortable" data-sort="weight" style="cursor:pointer; user-select:none;" title="点击按占比排序">占比 <span class="sort-icon">↓</span></th>
              </tr>
            </thead>
            <tbody id="positions-tbody">
              <tr><td colspan="11" class="table__empty">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 持仓矩形树图 -->
      <section class="dashboard__section animate-fade-in-up delay-5">
        <div class="chart-container">
          <div class="chart-container__header">
            <h3 class="chart-container__title">持仓全景 — 矩形树图</h3>
            <span class="chart-container__hint">面积 = 市值占比，颜色 = 盈亏幅度</span>
          </div>
          <div class="chart-container__body" id="chart-treemap" style="height:300px"></div>
        </div>
      </section>
    </div>
  `;
  
  // 加载数据
  await loadDashboardData(container);
  
  // 绑定排序事件
  container.querySelectorAll('.dashboard-sortable').forEach(th => {
    th.addEventListener('click', (e) => {
      const field = e.currentTarget.dataset.sort;
      if (currentSortField === field) {
        currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
      } else {
        currentSortField = field;
        currentSortOrder = 'desc'; // 默认从大到小
      }
      
      // 更新图标
      container.querySelectorAll('.dashboard-sortable .sort-icon').forEach(icon => icon.textContent = '');
      const icon = e.currentTarget.querySelector('.sort-icon');
      if (icon) {
        icon.textContent = currentSortOrder === 'desc' ? '↓' : '↑';
      }
      
      updatePositionTable(cachedPositions);
    });
  });
  
  // 绑定今日盈亏点击事件
  const dayPnlCard = container.querySelector('#kpi-day-pnl');
  if (dayPnlCard) {
    dayPnlCard.addEventListener('click', () => {
      showDayPnLModal(cachedPositions);
    });
  }
  
  // 绑定资产点击事件
  const valueCard = container.querySelector('#kpi-total-value');
  if (valueCard) {
    valueCard.addEventListener('click', () => {
      showValueModal(cachedPositions);
    });
  }

  // 绑定 YTD 点击事件
  const ytdCard = container.querySelector('#kpi-ytd');
  if (ytdCard) {
    ytdCard.addEventListener('click', () => {
      showYtdModal(cachedMarketSummaries);
    });
  }
  
  // 绑定收益率点击事件
  const returnCard = container.querySelector('#kpi-return-rates');
  if (returnCard) {
    returnCard.addEventListener('click', () => {
      showReturnRatesModal(cachedMarketSummaries);
    });
  }
  
  // 绑定市场概览点击事件
  const marketOverview = container.querySelector('#market-overview');
  if (marketOverview) {
    marketOverview.addEventListener('click', (e) => {
      const card = e.target.closest('.market-summary-card');
      if (card) {
        const marketId = card.dataset.market;
        showMarketPositionsModal(marketId, cachedPositions);
      }
    });
  }
  
  // 监听刷新事件
  const refreshHandler = () => loadDashboardData(container);
  window.addEventListener('stockvault:refresh', refreshHandler);
  
  // 页面卸载时清理
  const observer = new MutationObserver(() => {
    if (!document.getElementById('chart-pie')) {
      window.removeEventListener('stockvault:refresh', refreshHandler);
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });
}

/**
 * 加载仪表盘数据
 */
async function loadDashboardData(container) {
  try {
    // 并行获取数据
    const [positions, rates] = await Promise.all([
      get('/api/positions', { status: 'OPEN' }).catch(() => []),
      getExchangeRates().catch(() => ({ CNY: 1, USD: 0.1389, HKD: 1.0833, CHF: 0.1234 }))
    ]);
    
    const positionList = Array.isArray(positions) ? positions : [];
    
    // 尝试获取行情（可能受 API 限制）
    let quotes = {};
    try {
      const quoteData = await get('/api/summary');
      if (quoteData) {
        cachedMarketSummaries = quoteData.markets || quoteData.marketSummaries || {};
        updateKPICards(quoteData);
        updateMarketOverview(cachedMarketSummaries);
        updatePositionTable(quoteData.positions || positionList, rates);
        updateCharts(quoteData, positionList, rates);
        return;
      }
    } catch (e) {
      console.warn('[Dashboard] Summary API unavailable, using local calculation');
    }
    
    // 本地计算回退
    const { calculatePortfolioSummary } = await import('../services/portfolio.js');
    const quotesMap = new Map();
    const summary = calculatePortfolioSummary(positionList, quotesMap, rates);
    
    updateKPICards({
      totalValueCNY: summary.totalValueCNY,
      totalCostCNY: summary.totalCostCNY,
      totalPnlCNY: summary.totalPnLCNY,
      totalPnlPercent: summary.totalPnLPercent,
      dayPnl: summary.totalDayPnL,
      positionCount: summary.positionCount,
      totalAnnualizedReturn: summary.totalAnnualizedReturn,
      totalMonthlyReturn: summary.totalMonthlyReturn
    });
    
    cachedMarketSummaries = summary.marketSummaries || {};
    updateMarketOverview(cachedMarketSummaries);
    updatePositionTable(summary.positions || positionList, rates);
    updateCharts(summary, positionList, rates);
    
  } catch (error) {
    console.error('[Dashboard] Failed to load data:', error);
    showEmptyState();
  }
}

/**
 * 更新 KPI 卡片
 */
function updateKPICards(data) {
  const totalValue = data.totalValueCNY || data.totalValue || 0;
  const totalCost = data.totalCostCNY || data.totalCost || 0;
  const totalPnl = data.totalPnlCNY || data.totalPnl || totalValue - totalCost;
  const pnlPercent = data.totalPnlPercent || (totalCost > 0 ? (totalPnl / totalCost) * 100 : 0);
  const dayPnl = data.dayPnl || data.totalDayPnL || 0;
  const count = data.positionCount || 0;
  
  animateValue('val-total-value', totalValue, v => formatCurrency(v));
  
  const pnlEl = document.getElementById('val-total-pnl');
  if (pnlEl) {
    pnlEl.textContent = formatCurrency(totalPnl, 'CNY', true);
    pnlEl.className = `kpi-card__value kpi-card__value--${getPnLClass(totalPnl)}`;
  }
  
  const pnlPctEl = document.getElementById('val-total-pnl-pct');
  if (pnlPctEl) {
    pnlPctEl.textContent = formatPercent(pnlPercent);
    pnlPctEl.className = `kpi-card__sub kpi-card__sub--${getPnLClass(pnlPercent)}`;
  }
  
  const dayPnlEl = document.getElementById('val-day-pnl');
  if (dayPnlEl) {
    if (dayPnl == null || isNaN(dayPnl)) {
      dayPnlEl.textContent = '--';
    } else {
      const dayPnlWan = Math.abs(dayPnl) / 10000;
      const sign = dayPnl > 0 ? '+' : (dayPnl < 0 ? '-' : '');
      dayPnlEl.textContent = `${sign}¥${dayPnlWan.toFixed(2)}万`;
    }
    dayPnlEl.className = `kpi-card__value kpi-card__value--${getPnLClass(dayPnl)}`;
  }
  
  const dayPnlPercent = data.dayPnlPercent || data.totalDayPnLPercent || (totalValue - dayPnl > 0 ? (dayPnl / (totalValue - dayPnl)) * 100 : 0);
  const dayPnlPctEl = document.getElementById('val-day-pnl-pct');
  if (dayPnlPctEl) {
    dayPnlPctEl.textContent = formatPercent(dayPnlPercent);
    dayPnlPctEl.className = `kpi-card__sub kpi-card__sub--${getPnLClass(dayPnlPercent)}`;
  }
  
  // YTD 卡片
  const ytdPct = data.portfolioYtdPercent || 0;
  const ytdPctEl = document.getElementById('val-ytd-pct');
  if (ytdPctEl) {
    ytdPctEl.textContent = formatPercent(ytdPct);
    ytdPctEl.className = `kpi-card__value kpi-card__value--${getPnLClass(ytdPct)}`;
  }
  
  // 收益率卡片
  const annualizedReturn = data.totalAnnualizedReturn || 0;
  const annualEl = document.getElementById('val-annualized-return');
  if (annualEl) {
    annualEl.textContent = formatPercent(annualizedReturn);
    annualEl.className = `kpi-card__value kpi-card__value--${getPnLClass(annualizedReturn)}`;
  }
}

/**
 * 更新各国市场概览
 */
function updateMarketOverview(marketData) {
  const overview = document.getElementById('market-overview');
  if (!overview) return;
  
  const totalValue = Object.values(marketData).reduce((sum, m) => sum + (m.totalValue || 0), 0);
  
  overview.innerHTML = MARKET_IDS.map(id => {
    const data = marketData[id] || {};
    return renderMarketCard(id, data, totalValue);
  }).join('');
}

/**
 * 生成迷你趋势 SVG 折线图（带渐变填充）
 */
function generateSparklineSVG(pnlPct, marketId) {
  // 基于 pnlPct 生成伪随机但确定性的趋势数据
  const seed = marketId.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const points = [];
  const count = 12;
  const isProfit = pnlPct >= 0;
  
  for (let i = 0; i < count; i++) {
    // 使用 sin 混合产生自然波动的趋势线
    const trend = (i / (count - 1)) * (isProfit ? 1 : -1) * 0.6;
    const noise = Math.sin(seed * (i + 1) * 0.7) * 0.25 + Math.sin(seed * (i + 1) * 1.3) * 0.15;
    points.push(0.5 + trend + noise);
  }
  
  // 归一化到 [0.1, 0.9]
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const normalized = points.map(p => 0.1 + ((p - min) / range) * 0.8);
  
  const w = 100;
  const h = 36;
  const stepX = w / (count - 1);
  
  const linePoints = normalized.map((y, i) => `${(i * stepX).toFixed(1)},${(h - y * h).toFixed(1)}`).join(' ');
  const areaPoints = `0,${h} ${linePoints} ${w},${h}`;
  
  const color = isProfit ? 'var(--color-profit)' : 'var(--color-loss)';
  const gradId = `sparkGrad_${marketId}`;
  
  return `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points="${areaPoints}" fill="url(#${gradId})" />
      <polyline points="${linePoints}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

/**
 * 渲染单个市场卡片 — Premium Redesign
 */
function renderMarketCard(marketId, data, totalValue = 0) {
  const market = MARKETS[marketId];
  const value = data?.totalValue || 0;
  const pnl = data?.totalPnL || data?.totalPnl || 0;
  const pnlPct = data?.pnlPercent || (data?.totalCost > 0 ? (pnl / data.totalCost) * 100 : 0);
  const count = data?.positionCount || 0;
  const weight = totalValue > 0 ? (value / totalValue * 100) : 0;
  
  const pnlClass = getPnLClass(pnl);
  const pctClass = getPnLClass(pnlPct);
  const pnlArrow = pnl > 0 ? '<span class="market-summary-card__arrow">↑</span>' : pnl < 0 ? '<span class="market-summary-card__arrow">↓</span>' : '';
  const pctArrow = pnlPct > 0 ? '<span class="market-summary-card__arrow">↑</span>' : pnlPct < 0 ? '<span class="market-summary-card__arrow">↓</span>' : '';
  
  const sparklineSVG = generateSparklineSVG(pnlPct, marketId);
  
  return `
    <div class="market-summary-card market-summary-card--${marketId.toLowerCase()}" data-market="${marketId}" style="cursor:pointer;" title="点击查看持仓明细">
      <div class="market-summary-card__header">
        <span class="market-summary-card__flag">${market.flag}</span>
        <span class="market-summary-card__name">${market.label}</span>
        <span style="margin-left:8px; font-size:0.8rem; font-weight:600;" class="market-summary-card__stat-value--${getPnLClass(data?.monthlyReturn || 0)}">
          月收益 ${formatPercent(data?.monthlyReturn || 0)}
        </span>
        <span class="market-summary-card__count">${count} 笔</span>
      </div>
      
      <div class="market-summary-card__body">
        <!-- Row 1: 市值 + 盈亏 -->
        <div class="market-summary-card__stat-row">
          <div class="market-summary-card__stat market-summary-card__stat--primary">
            <span class="market-summary-card__stat-label">市值</span>
            <span class="market-summary-card__stat-value market-summary-card__stat-value--primary">${formatCurrency(value)}</span>
          </div>
          <div class="market-summary-card__stat market-summary-card__stat--secondary">
            <span class="market-summary-card__stat-label">盈亏</span>
            <span class="market-summary-card__stat-value market-summary-card__stat-value--secondary market-summary-card__stat-value--${pnlClass}">
              ${pnlArrow}${formatCurrency(pnl, 'CNY', true)}
            </span>
          </div>
        </div>
        
        <!-- Row 2: 收益率 + Sparkline -->
        <div class="market-summary-card__sparkline-area">
          <div class="market-summary-card__sparkline-data">
            <span class="market-summary-card__stat-label">收益率</span>
            <span class="market-summary-card__stat-value market-summary-card__stat-value--secondary market-summary-card__stat-value--${pctClass}">
              ${pctArrow}${formatPercent(pnlPct)}
            </span>
          </div>
          <div class="market-summary-card__sparkline-chart">
            ${sparklineSVG}
          </div>
        </div>
      </div>
      
      <!-- Progress bar + weight label -->
      <div class="market-summary-card__bar">
        <div class="market-summary-card__bar-fill" style="width: ${Math.min(weight, 100)}%"></div>
      </div>
      <div class="market-summary-card__bar-label">
        <span class="market-summary-card__bar-diamond"></span>
        占比 ${weight.toFixed(1)}%
      </div>
    </div>
  `;
}

/**
 * 更新持仓表格（仪表盘版：现价/成本用本币，市值/盈亏用人民币汇总）
 */
function updatePositionTable(positions, rates) {
  const tbody = document.getElementById('positions-tbody');
  if (!tbody) return;
  
  if (positions) {
    cachedPositions = positions;
  }
  
  if (!cachedPositions || cachedPositions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="table__empty">
          <div class="empty-state">
            <div class="empty-state__icon"><i data-lucide="inbox" style="width: 48px; height: 48px; stroke-width: 1.5;"></i></div>
            <p class="empty-state__text">暂无持仓</p>
            <a href="#/trade" class="btn btn--primary btn--sm">录入第一笔交易</a>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };
  function fmtNative(amount, currency) {
    const sym = CURRENCY_SYMBOL[currency] || '';
    const num = Number(amount);
    const absNum = Math.abs(num);
    const formattedAbs = absNum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num < 0) return `-${sym}${formattedAbs}`;
    return `${sym}${formattedAbs}`;
  }

  // 排序
  const sortedPositions = [...cachedPositions].sort((a, b) => {
    let valA = 0;
    let valB = 0;
    
    if (currentSortField === 'weight') {
      valA = a.weight || 0;
      valB = b.weight || 0;
    } else if (currentSortField === 'pnl') {
      valA = a.pnlCNY || a.pnl_cny || 0;
      valB = b.pnlCNY || b.pnl_cny || 0;
    } else if (currentSortField === 'ytd') {
      valA = a.ytdPercent || 0;
      valB = b.ytdPercent || 0;
    }
    
    return currentSortOrder === 'desc' ? valB - valA : valA - valB;
  });

  tbody.innerHTML = sortedPositions.map(pos => {
    const market = MARKETS[pos.market] || {};
    const currency = pos.currency || market.currency || 'CNY';
    const pnl = pos.pnlCNY || pos.pnl_cny || 0;
    const pnlPct = pos.pnlPercent || pos.pnl_percent || 0;
    const weight = pos.weight || 0;
    const marketValueCNY = pos.marketValueCNY || pos.valueCNY || 0;
    const currentPrice = pos.currentPrice || pos.current_price || pos.open_price || 0;
    const hasLive = pos.hasLivePrice;
    
    return `
      <tr class="table__row table__row--hoverable">
        <td class="table__td">
          <div class="table__stock-name">
            <span class="table__stock-primary pos-name-click" style="font-weight:600; cursor:pointer; color:var(--color-primary); border-bottom:1px dashed var(--color-primary);" data-id="${pos.id}" data-symbol="${pos.symbol}" data-name="${pos.name}" data-currency="${currency}" title="点击查看逐笔未平仓明细 (${pos.name})">${pos.name}</span>
          </div>
        </td>
        <td class="table__td table__td--mono">${pos.symbol}</td>
        <td class="table__td" title="${market.label || pos.market}">
          ${market.flag || ''}
        </td>
        <td class="table__td table__td--right">${formatQuantity(pos.quantity)}</td>
        <td class="table__td table__td--right table__td--mono" title="${hasLive ? '实时价格' : '使用开仓价'}">
          ${fmtNative(currentPrice, currency)}${hasLive ? '' : ' <small style="color:var(--color-text-muted)">*</small>'}
        </td>
        <td class="table__td table__td--right table__td--mono">${fmtNative(pos.open_price, currency)}</td>
        <td class="table__td table__td--right table__td--mono">${formatCurrency(marketValueCNY)}</td>
        <td class="table__td table__td--right table__td--${getPnLClass(pnl)}">
          ${formatCurrency(pnl, 'CNY', true)}
        </td>
        <td class="table__td table__td--right table__td--${getPnLClass(pnlPct)}">
          ${formatPercent(pnlPct)}
        </td>
        <td class="table__td table__td--right table__td--${getPnLClass(pos.ytdPercent || 0)}">
          ${formatPercent(pos.ytdPercent || 0)}
        </td>
        <td class="table__td table__td--right">${weight.toFixed(1)}%</td>
      </tr>
    `;
  }).join('');

  bindPositionTableEvents();
}

function bindPositionTableEvents() {
  const tbody = document.getElementById('positions-tbody');
  if (!tbody) return;

  tbody.querySelectorAll('.pos-name-click').forEach(btn => {
    btn.addEventListener('click', () => {
      const { id, symbol, name, currency } = btn.dataset;
      const pos = cachedPositions.find(p => (p.symbol || '').toUpperCase() === symbol.toUpperCase());
      if (pos && pos.activeLots && pos.activeLots.length > 0) {
        showActiveLotsModal({ id, name, symbol }, currency, pos.activeLots);
      } else {
        alert('暂无该股票的未平仓逐笔明细数据（仅在持有仓位时显示）。');
      }
    });
  });
}


/**
 * 更新图表
 */
async function updateCharts(summary, positions, rates) {
  try {
    const { initTheme } = await import('../charts/theme.js');
    initTheme();
    
    // 持仓饼图
    const pieContainer = document.getElementById('chart-pie');
    if (pieContainer && summary.marketSummaries) {
      const { renderPortfolioPie } = await import('../charts/portfolioPie.js');
      const pieData = Object.entries(summary.marketSummaries || {})
        .filter(([_, v]) => v.totalValue > 0)
        .map(([id, v]) => ({
          name: MARKETS[id]?.label || id,
          value: v.totalValue || 0
        }));
      if (pieData.length > 0) renderPortfolioPie(pieContainer, pieData);
    }
    
    // 盈亏排名
    const barContainer = document.getElementById('chart-pnl-bar');
    if (barContainer) {
      const { renderPnLBar } = await import('../charts/pnlBar.js');
      const barData = (summary.positions || positions || [])
        .filter(p => p.status === 'OPEN' || !p.status)
        .map(p => ({
          name: p.name,
          pnl: p.pnlCNY || p.pnl_cny || 0,
          pnlPercent: p.pnlPercent || p.pnl_percent || 0
        }))
        .sort((a, b) => b.pnl - a.pnl);
      if (barData.length > 0) renderPnLBar(barContainer, barData);
    }
    
    // 矩形树图
    const treemapContainer = document.getElementById('chart-treemap');
    if (treemapContainer) {
      const { renderTreemap } = await import('../charts/portfolioTreemap.js');
      const treemapData = (summary.positions || positions || [])
        .filter(p => (p.status === 'OPEN' || !p.status) && (p.marketValueCNY || p.valueCNY) > 0)
        .map(p => ({
          name: p.name,
          value: p.marketValueCNY || p.valueCNY || 0,
          pnlPercent: p.pnlPercent || p.pnl_percent || 0,
          market: p.market
        }));
      if (treemapData.length > 0) renderTreemap(treemapContainer, treemapData);
    }
    
    // 饼图模式切换
    document.querySelectorAll('[data-pie-mode]').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('[data-pie-mode]').forEach(b => b.classList.remove('chart-controls__btn--active'));
        btn.classList.add('chart-controls__btn--active');
        
        const mode = btn.dataset.pieMode;
        const { renderPortfolioPie } = await import('../charts/portfolioPie.js');
        const pieContainer = document.getElementById('chart-pie');
        
        let pieData;
        if (mode === 'market') {
          pieData = Object.entries(summary.marketSummaries || {})
            .filter(([_, v]) => v.totalValue > 0)
            .map(([id, v]) => ({ name: MARKETS[id]?.label || id, value: v.totalValue }));
        } else {
          pieData = (summary.positions || positions || [])
            .filter(p => (p.marketValueCNY || p.valueCNY) > 0)
            .map(p => ({ name: p.name, value: p.marketValueCNY || p.valueCNY || 0 }));
        }
        
        if (pieData.length > 0 && pieContainer) renderPortfolioPie(pieContainer, pieData);
      });
    });
    
  } catch (error) {
    console.error('[Dashboard] Chart rendering failed:', error);
  }
}

/**
 * 更新资产走势图
 */
async function updateAssetTrendChart(snapshots) {
  const container = document.getElementById('chart-asset-trend');
  if (!container) return;
  
  try {
    const { renderAssetTrend } = await import('../charts/assetTrend.js');
    renderAssetTrend(container, snapshots);
  } catch (err) {
    console.error('[Dashboard] Asset trend chart failed:', err);
  }
}

/**
 * 数字动画
 */
function animateValue(elementId, targetValue, formatter) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  const duration = 800;
  const startTime = performance.now();
  const startValue = 0;
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = startValue + (targetValue - startValue) * eased;
    
    el.textContent = formatter(currentValue);
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

/**
 * 显示空状态
 */
function showEmptyState() {
  const tbody = document.getElementById('positions-tbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="table__empty">
          <div class="empty-state">
            <div class="empty-state__icon animate-float">📊</div>
            <h3 class="empty-state__title">开始您的投资之旅</h3>
            <p class="empty-state__text">录入您的第一笔交易，开始追踪您的全球投资组合</p>
            <a href="#/trade" class="btn btn--primary">录入交易</a>
          </div>
        </td>
      </tr>
    `;
  }
}

/**
 * 显示今日盈亏明细弹窗
 */
async function showDayPnLModal(positions) {
  document.getElementById('day-pnl-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'day-pnl-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
    animation: fadeIn 0.15s ease;
  `;

  const openPositions = positions.filter(p => p.status === 'OPEN' || !p.status);
  
  const sorted = [...openPositions].sort((a, b) => {
    const valA = a.dayPnLCNY || a.day_pnl_cny || 0;
    const valB = b.dayPnLCNY || b.day_pnl_cny || 0;
    return valB - valA; // desc
  });

  const totalDayPnL = openPositions.reduce((sum, p) => sum + (p.dayPnLCNY || p.day_pnl_cny || 0), 0);
  
  const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };
  
  function fmtExactPnL(amount, currency) {
    const sym = CURRENCY_SYMBOL[currency] || '';
    const num = Number(amount);
    const absNum = Math.abs(num);
    const formattedAbs = absNum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num < 0) return `-${sym}${formattedAbs}`;
    if (num > 0) return `+${sym}${formattedAbs}`;
    return `${sym}${formattedAbs}`;
  }

  overlay.innerHTML = `
    <div style="
      background:var(--color-bg-card,#1e1e2e); border:1px solid var(--color-border,#374151);
      border-radius:20px; padding:24px; width:800px; max-width:95vw; 
      box-shadow:var(--shadow-lg); display:flex; flex-direction:column;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="margin:0; font-size:1.25rem; display:flex; align-items:center; gap:8px;">
          📊 今日盈亏总额：<span class="market-summary-card__stat-value--${getPnLClass(totalDayPnL)}">${fmtExactPnL(totalDayPnL, 'CNY')}</span>
        </h3>
        <button id="close-day-pnl" class="btn btn--icon btn--ghost" style="border-radius:50%; width:32px; height:32px;">✕</button>
      </div>
      
      <div id="day-pnl-chart-container" style="height: 400px; width: 100%;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-day-pnl').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // 准备图表数据
  const chartData = sorted.map(p => {
    const dayPnl = p.dayPnLCNY || p.day_pnl_cny || 0;
    const marketValueCNY = p.marketValueCNY || p.valueCNY || 0;
    const prevValueCNY = marketValueCNY - dayPnl;
    const pnlPercent = prevValueCNY > 0 ? (dayPnl / prevValueCNY) * 100 : (prevValueCNY < 0 ? (dayPnl / Math.abs(prevValueCNY)) * 100 : 0);
    return { name: p.name, pnl: dayPnl, pnlPercent: pnlPercent };
  });

  // 加载并渲染图表
  try {
    const { renderPnLBar } = await import('../charts/pnlBar.js');
    const container = overlay.querySelector('#day-pnl-chart-container');
    if (container) {
      renderPnLBar(container, chartData);
    }
  } catch (err) {
    console.error('Failed to load pnlBar chart:', err);
  }
}

/**
 * 显示市场持仓明细弹窗
 */
function showMarketPositionsModal(marketId, positions) {
  document.getElementById('market-positions-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'market-positions-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
    animation: fadeIn 0.15s ease;
  `;

  const market = MARKETS[marketId] || {};
  const marketPositions = positions.filter(p => (p.status === 'OPEN' || !p.status) && p.market === marketId);
  
  const sorted = [...marketPositions].sort((a, b) => {
    const valA = a.marketValueOriginal || (a.currentPrice || a.current_price || a.open_price) * a.quantity;
    const valB = b.marketValueOriginal || (b.currentPrice || b.current_price || b.open_price) * b.quantity;
    return valB - valA; // desc
  });

  const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };
  function fmtNative(amount, currency) {
    const sym = CURRENCY_SYMBOL[currency] || '';
    const num = Number(amount);
    const absNum = Math.abs(num);
    const formattedAbs = absNum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num < 0) return `-${sym}${formattedAbs}`;
    return `${sym}${formattedAbs}`;
  }

  const rowsHtml = sorted.length === 0 
    ? `<tr><td colspan="8" class="table__empty">暂无持仓</td></tr>`
    : sorted.map(pos => {
        const currency = pos.currency || market.currency || 'CNY';
        const currentPrice = pos.currentPrice || pos.current_price || pos.open_price || 0;
        const marketValue = pos.marketValueOriginal || currentPrice * pos.quantity;

        const isOpen = isMarketOpen(pos.market);
        const statusIndicator = isOpen 
          ? `<span style="color:#10b981; display:inline-flex; align-items:center;" title="开盘中"><i data-lucide="activity" style="width:14px; height:14px;"></i></span>` 
          : `<span style="color:#64748b; display:inline-flex; align-items:center;" title="休市"><i data-lucide="moon" style="width:14px; height:14px;"></i></span>`;

        const dayPnl = pos.dayPnLCNY || pos.day_pnl_cny || 0;
        const rateToCNY = pos.rateToCNY || pos.currentRate || 1;
        const dayPnlNative = dayPnl / rateToCNY;
        const totalPnlPct = pos.pnlPercent || pos.pnl_percent || 0;
        const marketValueCNY = pos.marketValueCNY || pos.valueCNY || 0;
        const prevValueCNY = marketValueCNY - dayPnl;
        const dayPnlPct = prevValueCNY > 0 ? (dayPnl / prevValueCNY) * 100 : (prevValueCNY < 0 ? (dayPnl / Math.abs(prevValueCNY)) * 100 : 0);

        return `
          <tr class="table__row table__row--hoverable">
            <td class="table__td">
              <div style="font-weight:600">${pos.name}</div>
              <div style="font-size:0.75rem;color:var(--color-text-secondary);font-family:monospace">${pos.symbol}</div>
            </td>
            <td class="table__td" style="text-align: center;">
              ${statusIndicator}
            </td>
            <td class="table__td table__td--right table__td--mono">
              ${formatQuantity(pos.quantity)}
            </td>
            <td class="table__td table__td--right table__td--mono">
              ${fmtNative(marketValue, currency)}
            </td>
            <td class="table__td table__td--right table__td--mono table__td--${getPnLClass(dayPnlNative)}">
              ${fmtNative(dayPnlNative, currency)}
            </td>
            <td class="table__td table__td--right table__td--${getPnLClass(dayPnlPct)}">
              ${formatPercent(dayPnlPct)}
            </td>
            <td class="table__td table__td--right table__td--${getPnLClass(totalPnlPct)}">
              ${formatPercent(totalPnlPct)}
            </td>
            <td class="table__td table__td--right table__td--${getPnLClass(pos.ytdPercent || 0)}">
              ${formatPercent(pos.ytdPercent || 0)}
            </td>
          </tr>
        `;
      }).join('');

  overlay.innerHTML = `
    <div style="
      background:var(--color-bg-card,#1e1e2e); border:1px solid var(--color-border,#374151);
      border-radius:20px; padding:24px; width:max-content; min-width:60%; max-width:95vw; 
      box-shadow:var(--shadow-lg); max-height:80vh; display:flex; flex-direction:column;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="margin:0; font-size:1.25rem; display:flex; align-items:center; gap:8px;">
          ${market.flag || ''} ${market.label || marketId} 持仓列表
        </h3>
        <button id="close-market-positions" class="btn btn--icon btn--ghost" style="border-radius:50%; width:32px; height:32px;">✕</button>
      </div>
      
      <div class="table-wrapper" style="flex:1; overflow-y:auto; border-radius:12px;">
        <table class="table" style="width:100%;">
          <thead style="position:sticky; top:0; background:var(--color-bg-card); z-index:10;">
            <tr>
              <th class="table__th">股票</th>
              <th class="table__th" style="text-align:center;">状态</th>
              <th class="table__th table__th--right">持仓数量</th>
              <th class="table__th table__th--right">持仓金额</th>
              <th class="table__th table__th--right">今日盈亏</th>
              <th class="table__th table__th--right">今日盈亏%</th>
              <th class="table__th table__th--right">总盈亏%</th>
              <th class="table__th table__th--right" title="YTD收益率">YTD</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-market-positions').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

/**
 * 显示本金分布弹窗
 */
async function showCostModal(positions) {
  document.getElementById('cost-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'cost-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
    animation: fadeIn 0.15s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background:var(--color-bg-card,#1e1e2e); border:1px solid var(--color-border,#374151);
      border-radius:20px; padding:24px; width:800px; max-width:95vw; 
      box-shadow:var(--shadow-lg); display:flex; flex-direction:column;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="margin:0; font-size:1.25rem; display:flex; align-items:center; gap:8px;">
          🏦 本金分布 (CNY)
        </h3>
        <button id="close-cost-modal" class="btn btn--icon btn--ghost" style="border-radius:50%; width:32px; height:32px;">✕</button>
      </div>
      
      <div id="cost-chart-container" style="height: 400px; width: 100%;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-cost-modal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // 准备图表数据
  const openPositions = positions.filter(p => p.status === 'OPEN' || !p.status);
  const chartData = openPositions.map(p => {
    // 尽量获取已计算好的成本(CNY)，如果没有则估算
    let cost = p.costCNY || p.cost_cny;
    if (cost === undefined) {
      const rateToCNY = p.rateToCNY || p.currentRate || 1;
      cost = (p.open_price * p.quantity) * rateToCNY;
    }
    return { name: p.name, cost: cost };
  }).sort((a, b) => b.cost - a.cost);

  // 加载并渲染图表
  try {
    const { renderCostBar } = await import('../charts/costBar.js');
    const container = document.getElementById('cost-chart-container');
    if (container) {
      renderCostBar(container, chartData);
    }
  } catch (err) {
    console.error('Failed to load costBar chart:', err);
  }
}

/**
 * 显示资产分布弹窗
 */
async function showValueModal(positions) {
  document.getElementById('value-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'value-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
    animation: fadeIn 0.15s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background:var(--color-bg-card,#1e1e2e); border:1px solid var(--color-border,#374151);
      border-radius:20px; padding:24px; width:800px; max-width:95vw; 
      box-shadow:var(--shadow-lg); display:flex; flex-direction:column;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="margin:0; font-size:1.25rem; display:flex; align-items:center; gap:8px;">
          💰 资产分布 (CNY)
        </h3>
        <button id="close-value-modal" class="btn btn--icon btn--ghost" style="border-radius:50%; width:32px; height:32px;">✕</button>
      </div>
      
      <div id="value-chart-container" style="height: 400px; width: 100%;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-value-modal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // 准备图表数据
  const openPositions = positions.filter(p => p.status === 'OPEN' || !p.status);
  const chartData = openPositions.map(p => {
    // 优先使用已计算好的 CNY 计价市值
    let marketValue = p.marketValueCNY || p.valueCNY;
    if (marketValue === undefined) {
      const rateToCNY = p.rateToCNY || p.currentRate || 1;
      const currentPrice = p.currentPrice || p.current_price || p.open_price || 0;
      marketValue = (currentPrice * p.quantity) * rateToCNY;
    }
    return { name: p.name, marketValue: marketValue };
  }).sort((a, b) => b.marketValue - a.marketValue);

  // 加载并渲染图表
  try {
    const { renderValueBar } = await import('../charts/valueBar.js');
    const container = document.getElementById('value-chart-container');
    if (container) {
      renderValueBar(container, chartData);
    }
  } catch (err) {
    console.error('Failed to load valueBar chart:', err);
  }
}

/**
 * 显示各国市场年化收益率弹窗
 */
function showReturnRatesModal(marketSummaries) {
  document.getElementById('return-rates-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'return-rates-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
    animation: fadeIn 0.15s ease;
  `;

  const rowsHtml = MARKET_IDS.map(id => {
    const data = marketSummaries[id];
    if (!data || data.positionCount === 0) return '';
    const market = MARKETS[id];
    const annualizedReturn = data.annualizedReturn || 0;
    
    return `
      <tr class="table__row">
        <td class="table__td">
          <div style="display:flex; align-items:center; gap:8px;">
            ${market.flag} <span style="font-weight:600">${market.label}</span>
          </div>
        </td>
        <td class="table__td table__td--right">
          ${data.positionCount} 笔
        </td>
        <td class="table__td table__td--right table__td--mono">
          ${formatCurrency(data.totalValue || 0)}
        </td>
        <td class="table__td table__td--right table__td--${getPnLClass(annualizedReturn)}">
          ${formatPercent(annualizedReturn)}
        </td>
      </tr>
    `;
  }).join('');

  overlay.innerHTML = `
    <div style="
      background:var(--color-bg-card,#1e1e2e); border:1px solid var(--color-border,#374151);
      border-radius:20px; padding:24px; width:max-content; min-width:400px; max-width:95vw; 
      box-shadow:var(--shadow-lg); display:flex; flex-direction:column;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="margin:0; font-size:1.25rem; display:flex; align-items:center; gap:8px;">
          🎯 各国市场年化收益率
        </h3>
        <button id="close-return-rates-modal" class="btn btn--icon btn--ghost" style="border-radius:50%; width:32px; height:32px;">✕</button>
      </div>
      
      <div class="table-wrapper" style="border-radius:12px;">
        <table class="table" style="width:100%;">
          <thead style="background:var(--color-bg-card);">
            <tr>
              <th class="table__th">市场</th>
              <th class="table__th table__th--right">持仓</th>
              <th class="table__th table__th--right">总市值(CNY)</th>
              <th class="table__th table__th--right">年化收益率</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="4" class="table__empty">暂无持仓</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-return-rates-modal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

/**
 * 显示各市场 YTD 收益明细弹窗
 */
function showYtdModal(marketSummaries) {
  document.getElementById('ytd-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ytd-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
    animation: fadeIn 0.15s ease;
  `;

  let totalYtd = 0;
  const rowsHtml = MARKET_IDS.map(id => {
    const data = marketSummaries[id];
    if (!data || data.positionCount === 0) return '';
    const market = MARKETS[id];
    const ytdPnl = data.ytdPnlCNY || 0;
    totalYtd += ytdPnl;
    
    return `
      <tr class="table__row">
        <td class="table__td">
          <div style="display:flex; align-items:center; gap:8px;">
            ${market.flag} <span style="font-weight:600">${market.label}</span>
          </div>
        </td>
        <td class="table__td table__td--right">
          ${data.positionCount} 笔
        </td>
        <td class="table__td table__td--right table__td--mono">
          ${formatCurrency(data.totalValue || 0)}
        </td>
        <td class="table__td table__td--right table__td--mono table__td--${getPnLClass(ytdPnl)}">
          ${formatCurrency(ytdPnl, 'CNY', true)}
        </td>
        <td class="table__td table__td--right table__td--${getPnLClass(data.ytdPercent || 0)}">
          ${formatPercent(data.ytdPercent || 0)}
        </td>
      </tr>
    `;
  }).join('');

  overlay.innerHTML = `
    <div style="
      background:var(--color-bg-card,#1e1e2e); border:1px solid var(--color-border,#374151);
      border-radius:20px; padding:24px; width:max-content; min-width:500px; max-width:95vw; 
      box-shadow:var(--shadow-lg); display:flex; flex-direction:column;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="margin:0; font-size:1.25rem; display:flex; align-items:center; gap:8px;">
          📅 各市场 YTD 收益明细
          <span class="market-summary-card__stat-value--${getPnLClass(totalYtd)}" style="font-size:1rem;">
            合计 ${formatCurrency(totalYtd, 'CNY', true)}
          </span>
        </h3>
        <button id="close-ytd-modal" class="btn btn--icon btn--ghost" style="border-radius:50%; width:32px; height:32px;">✕</button>
      </div>
      
      <div class="table-wrapper" style="border-radius:12px;">
        <table class="table" style="width:100%;">
          <thead style="background:var(--color-bg-card);">
            <tr>
              <th class="table__th">市场</th>
              <th class="table__th table__th--right">持仓</th>
              <th class="table__th table__th--right">总市值(CNY)</th>
              <th class="table__th table__th--right">YTD 收益(CNY)</th>
              <th class="table__th table__th--right">YTD 收益率</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="5" class="table__empty">暂无持仓</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-ytd-modal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

