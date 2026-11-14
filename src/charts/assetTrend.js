import * as echarts from 'echarts';
import { disposeChart, setupResize } from './theme.js';
import { formatCurrency, formatPercent } from '../utils/format.js';
import { getColorScheme } from '../utils/colorScheme.js';

/**
 * Compute max drawdown and peak metrics from snapshot series
 * @param {Array} data - Array of { date, totalValueCNY, totalCostCNY, totalPnlCNY, ytdPnlCNY }
 * @returns {Object} { maxDrawdownPct, maxDrawdownVal, peakDate, troughDate, highVal, highDate }
 */
export function computeTrendMetrics(data) {
  if (!data || data.length < 2) {
    return {
      maxDrawdownPct: 0,
      maxDrawdownVal: 0,
      peakDate: null,
      troughDate: null,
      highVal: 0,
      highDate: null,
      periodChangeVal: 0,
      periodChangePct: 0
    };
  }

  let peakVal = -Infinity;
  let peakDate = data[0].date;
  let maxDDPct = 0;
  let maxDDVal = 0;
  let ddPeakDate = null;
  let ddTroughDate = null;

  let highVal = -Infinity;
  let highDate = data[0].date;

  for (const d of data) {
    const val = Number(d.totalValueCNY) || 0;
    if (val > highVal) {
      highVal = val;
      highDate = d.date;
    }
    if (val > peakVal) {
      peakVal = val;
      peakDate = d.date;
    } else if (peakVal > 0) {
      const ddVal = peakVal - val;
      const ddPct = (ddVal / peakVal) * 100;
      if (ddPct > maxDDPct) {
        maxDDPct = ddPct;
        maxDDVal = ddVal;
        ddPeakDate = peakDate;
        ddTroughDate = d.date;
      }
    }
  }

  const first = data[0];
  const last = data[data.length - 1];
  const periodChangeVal = (last.totalPnlCNY || 0) - (first.totalPnlCNY || 0);
  const baseVal = first.totalValueCNY || first.totalCostCNY || 1;
  const periodChangePct = baseVal > 0 ? (periodChangeVal / baseVal) * 100 : 0;

  return {
    maxDrawdownPct: maxDDPct,
    maxDrawdownVal: maxDDVal,
    peakDate: ddPeakDate,
    troughDate: ddTroughDate,
    highVal: highVal > -Infinity ? highVal : 0,
    highDate,
    periodChangeVal,
    periodChangePct
  };
}

/**
 * Render asset trend line chart with area gradient & multi-mode support.
 * @param {HTMLElement} container
 * @param {Array} data - Array of { date, totalValueCNY, totalCostCNY, totalPnlCNY, ytdPnlCNY }
 * @param {Object} [options={}] - { mode: 'value' | 'pnl' | 'ytd' }
 */
export function renderAssetTrend(container, data, options = {}) {
  if (!container) return;

  disposeChart(container);

  const mode = options.mode || 'value';

  // Not enough data
  if (!data || data.length < 2) {
    container.innerHTML = `
      <div style="
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        height:100%; color:var(--color-text-secondary,#94a3b8); gap:12px;
      ">
        <span style="font-size:2.5rem;">📈</span>
        <span style="font-size:0.9rem;">快照数据积累中（当前 ${data ? data.length : 0} 天），需至少 2 天快照以生成趋势曲线</span>
      </div>
    `;
    return;
  }

  const chart = echarts.init(container, 'stockvault');
  const isCN = getColorScheme() === 'cn';
  const profitColor = isCN ? '#ef4444' : '#10b981';
  const lossColor = isCN ? '#10b981' : '#ef4444';

  const dates = data.map(d => d.date);
  const values = data.map(d => Number(d.totalValueCNY) || 0);
  const costs = data.map(d => Number(d.totalCostCNY) || 0);
  const pnls = data.map(d => {
    if (d.totalPnlCNY != null) return Number(d.totalPnlCNY);
    return (Number(d.totalValueCNY) || 0) - (Number(d.totalCostCNY) || 0);
  });
  const ytds = data.map(d => Number(d.ytdPnlCNY) || 0);

  let series = [];

  if (mode === 'pnl' || mode === 'ytd') {
    const seriesData = mode === 'pnl' ? pnls : ytds;
    const seriesLabel = mode === 'pnl' ? '累计盈亏' : 'YTD 年内收益';
    const latestVal = seriesData[seriesData.length - 1] || 0;
    const mainColor = latestVal >= 0 ? profitColor : lossColor;
    const rgbaTop = latestVal >= 0
      ? (isCN ? 'rgba(239,68,68,0.32)' : 'rgba(16,185,129,0.32)')
      : (isCN ? 'rgba(16,185,129,0.32)' : 'rgba(239,68,68,0.32)');
    const rgbaBottom = latestVal >= 0
      ? (isCN ? 'rgba(239,68,68,0.02)' : 'rgba(16,185,129,0.02)')
      : (isCN ? 'rgba(16,185,129,0.02)' : 'rgba(239,68,68,0.02)');

    series = [
      {
        name: seriesLabel,
        type: 'line',
        data: seriesData,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: data.length <= 15,
        lineStyle: { width: 2.5, color: mainColor },
        itemStyle: { color: mainColor },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: rgbaTop },
            { offset: 1, color: rgbaBottom }
          ])
        },
        markPoint: {
          symbolSize: 44,
          label: {
            fontSize: 10,
            color: '#f8fafc',
            formatter: (p) => {
              const v = p.value;
              return Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + '万' : Math.round(v);
            }
          },
          data: [
            { type: 'max', name: '最高', itemStyle: { color: profitColor } },
            { type: 'min', name: '最低', itemStyle: { color: lossColor } }
          ]
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: 'rgba(148,163,184,0.3)', type: 'dashed', width: 1 },
          data: [{ yAxis: 0, label: { show: true, formatter: '盈亏平衡 0', color: '#64748b', fontSize: 10 } }]
        }
      }
    ];
  } else {
    // Default: 'value' (总市值 vs 总成本)
    series = [
      {
        name: '总市值',
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: data.length <= 15,
        lineStyle: { width: 2.5, color: '#6366f1' },
        itemStyle: { color: '#6366f1' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(99,102,241,0.35)' },
            { offset: 1, color: 'rgba(99,102,241,0.02)' }
          ])
        },
        markPoint: {
          symbolSize: 44,
          label: {
            fontSize: 10,
            color: '#fff',
            formatter: (p) => p.value >= 10000 ? (p.value / 10000).toFixed(1) + '万' : Math.round(p.value)
          },
          data: [
            { type: 'max', name: '峰值', itemStyle: { color: '#6366f1' } }
          ]
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
          width: 1.8,
          color: '#64748b',
          type: 'dashed'
        },
        itemStyle: { color: '#64748b' }
      }
    ];
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: function (params) {
        const idx = params[0].dataIndex;
        const row = data[idx] || {};
        const date = params[0].axisValue;
        let html = `<div style="font-weight:600;margin-bottom:6px;display:flex;justify-content:space-between;gap:16px;">
          <span>${date}</span>
          ${row.positionCount ? `<span style="color:#94a3b8;font-size:0.75rem;font-weight:400;">持仓 ${row.positionCount} 支</span>` : ''}
        </div>`;

        for (const p of params) {
          const color = p.color;
          const val = p.value;
          const isSigned = mode !== 'value';
          html += `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:3px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span>
                <span style="color:#cbd5e1;">${p.seriesName}</span>
              </span>
              <span style="font-family:'JetBrains Mono',monospace;font-weight:600;">${formatCurrency(val, 'CNY', isSigned)}</span>
            </div>
          `;
        }

        const pnl = pnls[idx] || 0;
        const cost = costs[idx] || 0;
        const pnlPct = cost > 0 ? ((pnl / cost) * 100) : 0;
        const pnlColor = pnl >= 0 ? profitColor : lossColor;

        if (mode === 'value') {
          html += `
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.15);color:${pnlColor};font-weight:600;display:flex;justify-content:space-between;gap:12px;">
              <span>浮动盈亏</span>
              <span style="font-family:'JetBrains Mono',monospace;">${formatCurrency(pnl, 'CNY', true)} (${formatPercent(pnlPct)})</span>
            </div>
          `;
        } else {
          html += `
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.15);color:#94a3b8;font-size:0.78rem;display:flex;justify-content:space-between;gap:12px;">
              <span>当日市值 / 成本</span>
              <span style="font-family:'JetBrains Mono',monospace;">${formatCurrency(values[idx])} / ${formatCurrency(cost)}</span>
            </div>
          `;
        }
        return html;
      }
    },
    legend: {
      show: mode === 'value',
      top: 0,
      right: 16,
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8
    },
    grid: {
      top: 32,
      bottom: 56,
      left: 16,
      right: 20,
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
          return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : v;
        }
      }
    },
    yAxis: {
      type: 'value',
      scale: mode === 'value',
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.06)' } },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        formatter: (v) => {
          if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + '万';
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
        height: 18,
        bottom: 8,
        borderColor: 'transparent',
        backgroundColor: 'rgba(148,163,184,0.05)',
        fillerColor: 'rgba(99,102,241,0.15)',
        handleStyle: { color: '#6366f1', borderColor: '#6366f1' },
        textStyle: { color: '#94a3b8', fontSize: 10 }
      }
    ],
    series
  };

  chart.setOption(option);
  setupResize(chart);
  return chart;
}
