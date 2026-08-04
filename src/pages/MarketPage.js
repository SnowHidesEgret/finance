/**
 * StockVault — 市场专区页
 * 基于 Finnhub 免费版 API 的综合市场情报中心
 * 包含：持仓概览、公司新闻、分析师评级、财报日历、基本面指标
 */
import { MARKET_IDS, MARKETS, API } from '../utils/constants.js';
import { navigate } from '../router/index.js';
import { get } from '../services/api.js';
import { batchFetchFinnhubData } from '../services/finnhubService.js';
import { formatCurrency, formatPercent, getPnLClass, formatNumber, formatQuantity } from '../utils/format.js';
import { getExchangeRates } from '../services/exchangeRate.js';
import { Toast } from '../utils/toast.js';

/** 页面级缓存 */
let _cachedSummary = null;
let _cachedPositions = [];
let _cachedFinnhub = null;
let _currentMarket = 'US';
let _newsShowCount = 10;

/**
 * 渲染市场专区页面
 */
export async function renderMarketPage(container, params) {
  _currentMarket = params?.id || 'US';
  _newsShowCount = 10;

  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">
          <span style="display:inline-flex; align-items:center; gap:8px;">
            <i data-lucide="globe" style="width:24px; height:24px;"></i>
            市场专区
          </span>
        </h2>
      </div>

      <!-- 市场 Tab 栏 -->
      <div class="market-page__tabs" id="market-tabs">
        ${MARKET_IDS.map(id => `
          <button class="market-page__tab ${_currentMarket === id ? 'market-page__tab--active' : ''}"
                  data-market="${id}">
            <span class="market-page__tab-flag">${MARKETS[id].flag}</span>
            <span class="market-page__tab-label">${MARKETS[id].label}</span>
          </button>
        `).join('')}
      </div>

      <!-- 主内容区 -->
      <div class="market-page__content" id="market-content">
        <div class="market-page__loading">
          <div class="market-page__spinner"></div>
          <span>正在加载市场数据...</span>
        </div>
      </div>
    </div>
  `;

  // Tab 切换
  container.querySelector('#market-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-market]');
    if (btn) {
      const marketId = btn.dataset.market;
      window.location.hash = `#/market/${marketId}`;
    }
  });

  // 加载数据
  await loadMarketData(container);
}

/**
 * 加载市场数据
 */
async function loadMarketData(container) {
  const content = container.querySelector('#market-content');
  if (!content) return;

  try {
    // 获取汇总与持仓
    const [summaryData, allPositions] = await Promise.all([
      get('/api/summary').catch(() => null),
      get('/api/positions', { status: 'OPEN' }).catch(() => []),
    ]);

    _cachedSummary = summaryData;
    _cachedPositions = summaryData?.positions?.filter(p => p.status === 'OPEN') || (Array.isArray(allPositions) ? allPositions : []);

    const marketPositions = _cachedPositions.filter(p => p.market === _currentMarket);
    const marketSummary = summaryData?.markets?.[_currentMarket] || summaryData?.marketSummaries?.[_currentMarket] || {};
    const marketLabel = MARKETS[_currentMarket]?.label || _currentMarket;

    // 渲染持仓概览 (所有市场都有)
    let html = renderOverviewSection(marketPositions, marketSummary);

    if (marketPositions.length > 0) {
      // 渲染数据卡片骨架
      html += renderFinnhubSkeleton();
      content.innerHTML = html;

      // 异步加载各股票分析数据
      const symbolsToFetch = marketPositions
        .map(p => p.symbol)
        .filter(Boolean);

      loadFinnhubModules(container, symbolsToFetch, marketPositions);
    } else {
      // 空持仓提示
      html += renderEmptyPositionsHint(marketLabel);
      content.innerHTML = html;
    }

    // 绑定持仓表格排序
    bindOverviewEvents(content, marketPositions);

  } catch (error) {
    console.error('[MarketPage] Failed to load data:', error);
    content.innerHTML = `
      <div class="market-page__error">
        <i data-lucide="alert-triangle" style="width:48px; height:48px; color:var(--color-loss);"></i>
        <h3>数据加载失败</h3>
        <p>${error.message || '请检查网络连接或后端服务状态。'}</p>
      </div>`;
  }
}

// translateToUSSymbol is no longer needed as all symbols are translated backend-side

// ═══════════════════════════════════════════════════════
//  模块 1: 持仓概览
// ═══════════════════════════════════════════════════════

function renderOverviewSection(positions, marketSummary) {
  const totalValue = marketSummary.totalValue || 0;
  const totalPnl = marketSummary.totalPnL || marketSummary.totalPnl || 0;
  const pnlPct = marketSummary.pnlPercent || (marketSummary.totalCost > 0 ? (totalPnl / marketSummary.totalCost) * 100 : 0);
  const count = positions.length;
  const annualized = marketSummary.annualizedReturn || 0;

  const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };

  const totalMarketValueCNY = positions.reduce((sum, p) => sum + (p.marketValueCNY || p.valueCNY || 0), 0);

  return `
    <section class="market-page__overview animate-fade-in-up">
      <div class="market-page__kpi-row">
        <div class="market-page__kpi">
          <div class="market-page__kpi-label">市值 (CNY)</div>
          <div class="market-page__kpi-value">${formatCurrency(totalValue, 'CNY', false, false)}</div>
        </div>
        <div class="market-page__kpi">
          <div class="market-page__kpi-label">持仓盈亏</div>
          <div class="market-page__kpi-value ${getPnLClass(totalPnl)}">${formatCurrency(totalPnl, 'CNY', true, false)}</div>
        </div>
        <div class="market-page__kpi">
          <div class="market-page__kpi-label">收益率</div>
          <div class="market-page__kpi-value ${getPnLClass(pnlPct)}">${formatPercent(pnlPct)}</div>
        </div>
        <div class="market-page__kpi">
          <div class="market-page__kpi-label">年化收益率</div>
          <div class="market-page__kpi-value ${getPnLClass(annualized)}">${formatPercent(annualized)}</div>
        </div>
        <div class="market-page__kpi" style="border-left:1px dashed var(--color-border); padding-left:16px;">
          <div class="market-page__kpi-label" style="display:inline-flex; align-items:center; gap:4px;">
            整体 Bate
            <i data-lucide="help-circle" style="width:12px; height:12px; color:var(--color-text-muted);" title="基于各持仓股票的市值权重与个股 Bate 加权计算得出"></i>
          </div>
          <div class="market-page__kpi-value" id="portfolio-beta-value" style="color:var(--color-accent);">加载中...</div>
        </div>
      </div>

      ${count > 0 ? `
        <div class="market-page__positions-table">
          <table class="table">
            <thead>
              <tr>
                <th class="table__th">名称</th>
                <th class="table__th">代码</th>
                <th class="table__th table__th--right">数量</th>
                <th class="table__th table__th--right">现价</th>
                <th class="table__th table__th--right">成本</th>
                <th class="table__th table__th--right">市值(¥)</th>
                <th class="table__th table__th--right">盈亏(¥)</th>
                <th class="table__th table__th--right">盈亏%</th>
                <th class="table__th table__th--right">占比</th>
              </tr>
            </thead>
            <tbody>
              ${positions.map(pos => {
                const currency = pos.currency || MARKETS[pos.market]?.currency || 'CNY';
                const sym = CURRENCY_SYMBOL[currency] || '';
                const pnl = pos.pnlCNY || pos.pnl_cny || 0;
                const pnlPercent = pos.pnlPercent || pos.pnl_percent || 0;
                const currentPrice = pos.currentPrice || pos.current_price || pos.open_price || 0;
                const marketValueCNY = pos.marketValueCNY || pos.valueCNY || 0;
                const weight = totalMarketValueCNY > 0 ? (marketValueCNY / totalMarketValueCNY) * 100 : 0;

                return `
                  <tr class="table__row table__row--hoverable">
                    <td class="table__td" style="font-weight:600;">${pos.name}</td>
                    <td class="table__td table__td--mono">${pos.symbol}</td>
                    <td class="table__td table__td--right">${formatQuantity(pos.quantity)}</td>
                    <td class="table__td table__td--right table__td--mono">${sym}${formatNumber(currentPrice)}</td>
                    <td class="table__td table__td--right table__td--mono">${sym}${formatNumber(pos.open_price)}</td>
                    <td class="table__td table__td--right table__td--mono">${formatCurrency(marketValueCNY)}</td>
                    <td class="table__td table__td--right table__td--${getPnLClass(pnl)}">${formatCurrency(pnl, 'CNY', true)}</td>
                    <td class="table__td table__td--right table__td--${getPnLClass(pnlPercent)}">${formatPercent(pnlPercent)}</td>
                    <td class="table__td table__td--right">${weight.toFixed(1)}%</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </section>
  `;
}

function bindOverviewEvents(content) {
  // Future: sorting, click handlers
}

// ═══════════════════════════════════════════════════════
//  Finnhub 模块骨架
// ═══════════════════════════════════════════════════════

function renderFinnhubSkeleton() {
  return `
    <div class="market-page__finnhub-grid">


      <!-- 右列：财报日历 -->
      <section class="market-page__earnings card animate-fade-in-up" id="finnhub-earnings">
        <div class="market-page__section-header">
          <h3><i data-lucide="calendar" style="width:18px; height:18px;"></i> 财报日历</h3>
        </div>
        <div class="market-page__skeleton-list">
          ${Array(3).fill('').map(() => `
            <div class="market-page__skeleton-item">
              <div class="skeleton-line skeleton-line--short"></div>
              <div class="skeleton-line skeleton-line--text"></div>
            </div>
          `).join('')}
        </div>
      </section>



      <!-- 基本面指标 -->
      <section class="market-page__financials card animate-fade-in-up" id="finnhub-financials">
        <div class="market-page__section-header">
          <h3><i data-lucide="bar-chart-3" style="width:18px; height:18px;"></i> 基本面指标</h3>
        </div>
        <div class="market-page__skeleton-list">
          ${Array(3).fill('').map(() => `
            <div class="market-page__skeleton-item">
              <div class="skeleton-line skeleton-line--title"></div>
              <div class="skeleton-line skeleton-line--text"></div>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
//  异步加载 Finnhub 模块数据
// ═══════════════════════════════════════════════════════

async function loadFinnhubModules(container, symbols, positions) {
  try {
    const data = await batchFetchFinnhubData(symbols);
    _cachedFinnhub = data;

    if (data.noApiKey) {
      renderNoApiKeyHint(container);
      return;
    }

    // 渲染各模块
    renderEarningsModule(container, data.earnings, positions);

    renderFinancialsModule(container, data.financials, positions);

    // 计算并更新整体 Beta 值
    updatePortfolioBeta(container, data.financials, positions);

  } catch (error) {
    console.error('[MarketPage] Finnhub load failed:', error);
    const sections = container.querySelectorAll('.market-page__skeleton-list');
    sections.forEach(s => {
      s.innerHTML = `<div style="text-align:center; color:var(--color-text-muted); padding:24px;">Finnhub 数据加载失败</div>`;
    });
  }
}

function renderNoApiKeyHint(container) {
  const earningsEl = container.querySelector('#finnhub-earnings');
  const finEl = container.querySelector('#finnhub-financials');

  const hint = `
    <div class="market-page__no-key">
      <i data-lucide="key" style="width:32px; height:32px; color:var(--color-accent);"></i>
      <h4>需要配置 Finnhub API Key</h4>
      <p>市场分析功能依赖 Finnhub 免费 API。请前往设置页面配置您的 API 密钥。</p>
      <button class="btn btn--primary btn--sm" onclick="window.location.hash='#/settings'">
        前往设置
      </button>
    </div>
  `;

  [earningsEl, finEl].forEach(el => {
    if (el) {
      const body = el.querySelector('.market-page__skeleton-list') || el.querySelector('div[style*="height"]');
      if (body) body.innerHTML = hint;
      else el.innerHTML += hint;
    }
  });
}



// ═══════════════════════════════════════════════════════
//  模块 4: 财报日历
// ═══════════════════════════════════════════════════════

function renderEarningsModule(container, earningsList, positions) {
  const el = container.querySelector('#finnhub-earnings');
  if (!el) return;

  const bodyEl = el.querySelector('.market-page__skeleton-list');
  if (!bodyEl) return;

  if (!earningsList || earningsList.length === 0) {
    bodyEl.innerHTML = `
      <div class="market-page__empty">
        <i data-lucide="calendar-off" style="width:32px; height:32px;"></i>
        <span>近期无财报事件</span>
      </div>`;
    return;
  }

  // 按日期分组
  const today = new Date().toISOString().split('T')[0];
  const grouped = {};
  earningsList.forEach(e => {
    const date = e.date || 'Unknown';
    if (!grouped[date]) grouped[date] = [];
    const pos = positions.find(p => p.symbol === (e._symbol || e.symbol));
    grouped[date].push({ ...e, posName: pos?.name || e.symbol || e._symbol });
  });

  const sortedDates = Object.keys(grouped).sort();

  bodyEl.innerHTML = `
    <div class="market-page__timeline">
      ${sortedDates.map(date => {
        const isPast = date < today;
        const isToday = date === today;
        const dateLabel = isToday ? '📍 今天' : formatDateLabel(date);
        const items = grouped[date];

        return `
          <div class="market-page__timeline-group ${isPast ? 'market-page__timeline-group--past' : ''}">
            <div class="market-page__timeline-date ${isToday ? 'market-page__timeline-date--today' : ''}">${dateLabel}</div>
            ${items.map(item => {
              const pos = positions.find(p => p.symbol === (item._symbol || item.symbol));
              const currency = pos?.currency || MARKETS[pos?.market]?.currency || 'USD';
              const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };
              const currencySymbol = CURRENCY_SYMBOL[currency] || '$';
              return `
                <div class="market-page__timeline-item">
                  <div class="market-page__timeline-dot"></div>
                  <div class="market-page__timeline-content">
                    <span class="market-page__timeline-name">${item.posName}</span>
                    <span class="market-page__timeline-symbol">${item._symbol || item.symbol || ''}</span>
                    ${item.epsEstimate ? `<span class="market-page__timeline-eps">EPS 预估: ${currencySymbol}${item.epsEstimate}</span>` : ''}
                    ${item.hour ? `<span class="market-page__timeline-hour">${item.hour === 'bmo' ? '盘前' : item.hour === 'amc' ? '盘后' : item.hour}</span>` : ''}
                  </div>
                </div>`;
            }).join('')}
          </div>`;
      }).join('')}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
//  模块 5: 基本面指标
// ═══════════════════════════════════════════════════════

function renderFinancialsModule(container, financialsMap, positions) {
  const el = container.querySelector('#finnhub-financials');
  if (!el) return;

  const bodyEl = el.querySelector('.market-page__skeleton-list');
  if (!bodyEl) return;

  if (!financialsMap || financialsMap.size === 0) {
    bodyEl.innerHTML = `
      <div class="market-page__empty">
        <i data-lucide="file-text" style="width:32px; height:32px;"></i>
        <span>暂无基本面指标数据</span>
      </div>`;
    return;
  }

  let html = '<div class="market-page__financials-grid">';

  for (const [symbol, data] of financialsMap) {
    const pos = positions.find(p => p.symbol === symbol);
    const name = pos?.name || symbol;
    const currency = pos?.currency || MARKETS[pos?.market]?.currency || 'USD';
    const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };
    const currencySymbol = CURRENCY_SYMBOL[currency] || '$';
    const m = data?.metric || {};
    const currentPrice = pos?.currentPrice || pos?.current_price || 0;
    const wk52High = m['52WeekHigh'] || 0;
    const wk52Low = m['52WeekLow'] || 0;
    const wk52Range = wk52High - wk52Low;
    const wk52Pct = wk52Range > 0 ? ((currentPrice - wk52Low) / wk52Range * 100) : 50;

    html += `
      <div class="market-page__fin-card">
        <div class="market-page__fin-header">
          <span class="market-page__fin-name">${name}</span>
          <span class="market-page__fin-symbol">${symbol}</span>
        </div>
        <div class="market-page__fin-metrics">
          ${renderMetricRow('P/E (TTM)', m.peNormalizedAnnual || m.peTTM, null)}
          ${renderMetricRow('P/B', m.pbAnnual || m.pbQuarterly, null)}
          ${renderMetricRow('EPS (TTM)', m.epsNormalizedAnnual || m.epsTTM, currencySymbol)}
          ${renderMetricRow('市值', m.marketCapitalization, null, true)}
          ${renderMetricRow('Beta', m.beta, null)}
          ${renderMetricRow('股息率', m.dividendYieldIndicatedAnnual, '%')}
          ${renderMetricRow('毛利率', m.grossMarginTTM, '%')}
          ${renderMetricRow('净利率', m.netProfitMarginTTM, '%')}
          ${renderMetricRow('ROE', m.roeTTM, '%')}
        </div>
        <div class="market-page__52w">
          <div class="market-page__52w-label">
            <span>${currencySymbol}${formatNumber(wk52Low)}</span>
            <span style="font-size:0.75rem; color:var(--color-text-muted);">52周区间</span>
            <span>${currencySymbol}${formatNumber(wk52High)}</span>
          </div>
          <div class="market-page__52w-bar">
            <div class="market-page__52w-fill" style="width: ${Math.min(Math.max(wk52Pct, 2), 98)}%;"></div>
            <div class="market-page__52w-marker" style="left: ${Math.min(Math.max(wk52Pct, 2), 98)}%;" title="当前价 ${currencySymbol}${formatNumber(currentPrice)}"></div>
          </div>
        </div>
      </div>
    `;
  }

  html += '</div>';
  bodyEl.innerHTML = html;
}

function renderMetricRow(label, value, unit, isCap = false) {
  let display = '--';
  if (value != null && !isNaN(value)) {
    if (isCap) {
      display = value >= 1000 ? `${(value / 1000).toFixed(1)}T` : `${value.toFixed(1)}B`;
    } else if (unit && unit !== '%') {
      display = `${unit}${Number(value).toFixed(2)}`;
    } else if (unit === '%') {
      display = `${Number(value).toFixed(2)}%`;
    } else {
      display = Number(value).toFixed(2);
    }
  }
  return `
    <div class="market-page__fin-row">
      <span class="market-page__fin-label">${label}</span>
      <span class="market-page__fin-value">${display}</span>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
//  非美股/空状态提示
// ═══════════════════════════════════════════════════════

function renderNonUSHint(marketLabel) {
  return `
    <div class="market-page__hint card animate-fade-in-up">
      <div class="market-page__hint-icon">
        <i data-lucide="info" style="width:40px; height:40px; color:var(--color-accent);"></i>
      </div>
      <h3>Finnhub 免费版仅支持美股数据</h3>
      <p>${marketLabel} 市场的深度分析功能（新闻、评级、财报日历、基本面指标）需要付费版 Finnhub 或其他数据源支持。</p>
      <p style="color:var(--color-text-muted); font-size:0.875rem; margin-top:8px;">切换到 <strong>美国</strong> 市场 Tab 查看完整的市场情报分析。</p>
    </div>
  `;
}

function renderEmptyPositionsHint(marketLabel) {
  return `
    <div class="market-page__hint card animate-fade-in-up">
      <div class="market-page__hint-icon">
        <i data-lucide="inbox" style="width:40px; height:40px; color:var(--color-text-muted);"></i>
      </div>
      <h3>暂无 ${marketLabel} 持仓</h3>
      <p>当您在该市场拥有持仓后，市场分析功能将自动激活。</p>
      <button class="btn btn--primary btn--sm" onclick="window.location.hash='#/trade'" style="margin-top:12px;">
        录入交易
      </button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════════

function formatTimeAgo(timestamp) {
  const sec = Math.floor((Date.now() - timestamp) / 1000);
  if (sec < 60) return '刚刚';
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  if (sec < 604800) return `${Math.floor(sec / 86400)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatDateLabel(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return `${month}月${day}日 ${weekday}`;
  } catch {
    return dateStr;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...';
}

function updatePortfolioBeta(container, financialsMap, positions) {
  const betaKpiVal = container.querySelector('#portfolio-beta-value');
  if (!betaKpiVal) return;

  let weightedBetaSum = 0;
  let totalWeightValue = 0;

  positions.forEach(pos => {
    const data = financialsMap.get(pos.symbol);
    const beta = data?.metric?.beta;
    const valueCNY = pos.marketValueCNY || pos.valueCNY || 0;

    if (beta != null && !isNaN(beta) && valueCNY > 0) {
      weightedBetaSum += valueCNY * beta;
      totalWeightValue += valueCNY;
    }
  });

  if (totalWeightValue > 0) {
    const portfolioBeta = weightedBetaSum / totalWeightValue;
    betaKpiVal.textContent = portfolioBeta.toFixed(2);
    
    let label = '中等风险';
    if (portfolioBeta > 1.2) label = '高弹性/高风险';
    else if (portfolioBeta < 0.8) label = '防御性/低风险';
    betaKpiVal.title = `基准市场波动为 1.0，当前投资组合波动度约为市场的 ${Math.round(portfolioBeta * 100)}% (${label})`;
  } else {
    betaKpiVal.textContent = '--';
    betaKpiVal.title = '暂无足够个股 Bate 数据计算整体 Bate';
  }
}
