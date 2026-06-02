/**
 * StockVault — 图表分析页
 * 包含资产走势折线图和更多高级分析图表
 */

import { formatCurrency, formatPercent, getPnLClass } from '../utils/format.js';
import { get } from '../services/api.js';

export async function renderChartsPage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">图表分析</h2>
      </div>

      <!-- 资产走势 -->
      <section class="dashboard__section animate-fade-in-up delay-1">
        <div class="chart-container" style="width:100%;">
          <div class="chart-container__header">
            <h3 class="chart-container__title">资产走势</h3>
            <div class="chart-controls">
              <button class="chart-controls__btn chart-controls__btn--active" data-trend-days="30">近30天</button>
              <button class="chart-controls__btn" data-trend-days="90">近90天</button>
              <button class="chart-controls__btn" data-trend-days="180">近半年</button>
              <button class="chart-controls__btn" data-trend-days="365">近一年</button>
            </div>
          </div>
          <div class="chart-container__body" id="chart-asset-trend" style="height:400px"></div>
        </div>
      </section>

      <!-- 更多图表占位 -->
      <section class="dashboard__section animate-fade-in-up delay-2">
        <div class="dashboard__charts-row">
          <div class="chart-container">
            <div class="chart-container__header">
              <h3 class="chart-container__title">YTD 各市场收益对比</h3>
            </div>
            <div class="chart-container__body" id="chart-ytd-market" style="height:320px"></div>
          </div>
          <div class="chart-container">
            <div class="chart-container__header">
              <h3 class="chart-container__title">持仓盈亏分布</h3>
            </div>
            <div class="chart-container__body" id="chart-pnl-scatter" style="height:320px"></div>
          </div>
        </div>
      </section>
    </div>
  `;

  // Init chart theme
  const { initTheme } = await import('../charts/theme.js');
  initTheme();

  // Load and render asset trend
  await loadAssetTrend(30);

  // Bind time range controls
  container.querySelectorAll('[data-trend-days]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      container.querySelectorAll('[data-trend-days]').forEach(b => b.classList.remove('chart-controls__btn--active'));
      e.currentTarget.classList.add('chart-controls__btn--active');
      const days = parseInt(e.currentTarget.dataset.trendDays, 10);
      await loadAssetTrend(days);
    });
  });

  // Load YTD market comparison and PnL scatter
  loadYtdMarketChart();
  loadPnlScatter();
}

/**
 * Load and render asset trend chart
 */
async function loadAssetTrend(days) {
  const container = document.getElementById('chart-asset-trend');
  if (!container) return;

  try {
    const snapshots = await get('/api/snapshots', { days, market: 'ALL' });
    const { renderAssetTrend } = await import('../charts/assetTrend.js');
    renderAssetTrend(container, snapshots || []);
  } catch (err) {
    console.error('[Charts] Asset trend failed:', err);
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--color-text-secondary);gap:12px;">
        <span style="font-size:2.5rem;">⚠️</span>
        <span style="font-size:0.9rem;">加载失败，请稍后重试</span>
      </div>
    `;
  }
}

/**
 * YTD market comparison bar chart
 */
async function loadYtdMarketChart() {
  const container = document.getElementById('chart-ytd-market');
  if (!container) return;

  try {
    const summary = await get('/api/summary');
    if (!summary?.markets) throw new Error('No market data');

    const { default: echarts } = await import('echarts');
    const { disposeChart, setupResize } = await import('../charts/theme.js');
    const { getColorScheme } = await import('../utils/colorScheme.js');

    disposeChart(container);
    const chart = echarts.init(container, 'stockvault');

    const isCN = getColorScheme() === 'cn';
    const profitColor = isCN ? '#ef4444' : '#10b981';
    const lossColor = isCN ? '#10b981' : '#ef4444';

    const MARKETS = { US: '🇺🇸 美股', HK: '🇭🇰 港股', A_SHARE: '🇨🇳 A股', SWISS: '🇨🇭 瑞士' };
    const entries = Object.entries(summary.markets)
      .filter(([_, d]) => d.positionCount > 0)
      .sort((a, b) => (b[1].ytdPnlCNY || 0) - (a[1].ytdPnlCNY || 0));

    const option = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const d = params[0];
          return `<b>${d.name}</b><br/>YTD 收益：${formatCurrency(d.value, 'CNY', true)}`;
        }
      },
      grid: { top: 20, bottom: 20, left: 10, right: 40, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: {
          formatter: (v) => Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + '万' : v
        }
      },
      yAxis: {
        type: 'category',
        data: entries.map(([id]) => MARKETS[id] || id),
        axisLine: { show: false },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        data: entries.map(([_, d]) => ({
          value: d.ytdPnlCNY || 0,
          itemStyle: {
            color: (d.ytdPnlCNY || 0) >= 0 ? profitColor : lossColor,
            borderRadius: [0, 4, 4, 0]
          }
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (p) => formatCurrency(p.value, 'CNY', true),
          color: '#94a3b8',
          fontSize: 11
        }
      }]
    };

    chart.setOption(option);
    setupResize(chart);
  } catch (err) {
    console.warn('[Charts] YTD market chart failed:', err);
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--color-text-secondary);gap:12px;">
        <span style="font-size:2.5rem;">📊</span>
        <span style="font-size:0.9rem;">暂无数据</span>
      </div>
    `;
  }
}

/**
 * PnL scatter / distribution chart
 */
async function loadPnlScatter() {
  const container = document.getElementById('chart-pnl-scatter');
  if (!container) return;

  try {
    const summary = await get('/api/summary');
    if (!summary?.positions || summary.positions.length === 0) throw new Error('No position data');

    const { default: echarts } = await import('echarts');
    const { disposeChart, setupResize } = await import('../charts/theme.js');
    const { getColorScheme } = await import('../utils/colorScheme.js');

    disposeChart(container);
    const chart = echarts.init(container, 'stockvault');

    const isCN = getColorScheme() === 'cn';
    const profitColor = isCN ? '#ef4444' : '#10b981';
    const lossColor = isCN ? '#10b981' : '#ef4444';

    const positions = summary.positions.filter(p => p.status === 'OPEN' || !p.status);

    const option = {
      tooltip: {
        formatter: (p) => {
          const d = p.data;
          return `<b>${d[3]}</b><br/>市值：${formatCurrency(d[0])}<br/>盈亏：${formatCurrency(d[1], 'CNY', true)}<br/>收益率：${formatPercent(d[2])}`;
        }
      },
      grid: { top: 20, bottom: 40, left: 16, right: 16, containLabel: true },
      xAxis: {
        name: '市值(CNY)',
        nameLocation: 'center',
        nameGap: 28,
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLabel: {
          formatter: (v) => v >= 10000 ? (v / 10000).toFixed(0) + '万' : v
        }
      },
      yAxis: {
        name: '收益率(%)',
        nameLocation: 'center',
        nameGap: 40,
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.06)' } },
        axisLabel: { formatter: (v) => v + '%' }
      },
      series: [{
        type: 'scatter',
        symbolSize: (val) => Math.max(8, Math.min(30, Math.sqrt(Math.abs(val[0])) / 8)),
        data: positions.map(p => {
          const mv = p.marketValueCNY || 0;
          const pnl = p.pnlCNY || 0;
          const pct = p.pnlPercent || 0;
          return {
            value: [mv, pct, pct, p.name],
            itemStyle: { color: pnl >= 0 ? profitColor : lossColor, opacity: 0.8 }
          };
        }),
        label: {
          show: true,
          position: 'top',
          formatter: (p) => p.data[3],
          color: '#94a3b8',
          fontSize: 10
        }
      }]
    };

    chart.setOption(option);
    setupResize(chart);
  } catch (err) {
    console.warn('[Charts] PnL scatter failed:', err);
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--color-text-secondary);gap:12px;">
        <span style="font-size:2.5rem;">📊</span>
        <span style="font-size:0.9rem;">暂无数据</span>
      </div>
    `;
  }
}
