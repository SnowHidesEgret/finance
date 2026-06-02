import * as echarts from 'echarts';
import { disposeChart, setupResize } from './theme.js';
import { formatCurrency } from '../utils/format.js';

/**
 * Render asset trend line chart with area gradient.
 * @param {HTMLElement} container
 * @param {Array} data - Array of { date, totalValueCNY, totalCostCNY, totalPnlCNY }
 */
export function renderAssetTrend(container, data) {
  if (!container) return;

  disposeChart(container);

  // Not enough data
  if (!data || data.length < 2) {
    container.innerHTML = `
      <div style="
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        height:100%; color:var(--color-text-secondary,#94a3b8); gap:12px;
      ">
        <span style="font-size:2.5rem;">📈</span>
        <span style="font-size:0.9rem;">快照数据积累中，请持续使用以生成走势图</span>
      </div>
    `;
    return;
  }

  const chart = echarts.init(container, 'stockvault');

  const dates = data.map(d => d.date);
  const values = data.map(d => d.totalValueCNY);
  const costs = data.map(d => d.totalCostCNY);

  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: function (params) {
        const date = params[0].axisValue;
        let html = `<div style="font-weight:600;margin-bottom:6px;">${date}</div>`;
        for (const p of params) {
          const color = p.color;
          const val = p.value;
          html += `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span>
              <span>${p.seriesName}：${formatCurrency(val)}</span>
            </div>
          `;
        }
        // PnL
        if (params.length >= 2) {
          const pnl = params[0].value - params[1].value;
          const pnlPct = params[1].value > 0 ? ((pnl / params[1].value) * 100).toFixed(2) : '0.00';
          const pnlColor = pnl >= 0 ? 'var(--color-profit,#10b981)' : 'var(--color-loss,#ef4444)';
          html += `
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.15);color:${pnlColor};font-weight:600;">
              盈亏：${formatCurrency(pnl, 'CNY', true)}（${pnlPct}%）
            </div>
          `;
        }
        return html;
      }
    },
    grid: {
      top: 20,
      bottom: 60,
      left: 16,
      right: 16,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        formatter: (v) => {
          const parts = v.split('-');
          return `${parts[1]}/${parts[2]}`;
        }
      }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.06)' } },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        formatter: (v) => {
          if (v >= 10000) return (v / 10000).toFixed(0) + '万';
          return v;
        }
      }
    },
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100
      },
      {
        type: 'slider',
        start: 0,
        end: 100,
        height: 20,
        bottom: 8,
        borderColor: 'transparent',
        backgroundColor: 'rgba(148,163,184,0.05)',
        fillerColor: 'rgba(99,102,241,0.15)',
        handleStyle: { color: '#6366f1', borderColor: '#6366f1' },
        textStyle: { color: '#94a3b8', fontSize: 10 }
      }
    ],
    series: [
      {
        name: '总市值',
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: false,
        lineStyle: { width: 2.5, color: '#6366f1' },
        itemStyle: { color: '#6366f1' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(99,102,241,0.35)' },
            { offset: 1, color: 'rgba(99,102,241,0.02)' }
          ])
        },
        emphasis: {
          focus: 'series',
          itemStyle: { borderWidth: 2, borderColor: '#fff' }
        }
      },
      {
        name: '总成本',
        type: 'line',
        data: costs,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          width: 1.5,
          color: '#64748b',
          type: 'dashed'
        },
        itemStyle: { color: '#64748b' }
      }
    ]
  };

  chart.setOption(option);
  setupResize(chart);
  return chart;
}
