import * as echarts from 'echarts';
import { disposeChart, setupResize } from './theme.js';
import { formatCurrency, formatPercent } from '../utils/format.js';
import { getColorScheme } from '../utils/colorScheme.js';

export function renderPnLBar(container, data) {
  if (!container || !data || data.length === 0) return;
  
  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');
  
  const isCN = getColorScheme() === 'cn';
  const profitColor = isCN ? '#ef4444' : '#10b981';
  const lossColor = isCN ? '#10b981' : '#ef4444';
  
  // Echarts bar charts draw from bottom to top for Y axis category, so we reverse the sorted data
  const chartData = [...data].reverse();
  
  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: function(params) {
        const item = params[0].data;
        return `
          <div style="font-weight:bold;margin-bottom:4px;">${params[0].name}</div>
          盈亏: ${formatCurrency(item.value, 'CNY', true)}<br/>
          收益率: ${formatPercent(item.pnlPercent)}
        `;
      }
    },
    grid: {
      top: 10,
      bottom: 20,
      left: 10,
      right: 40,
      containLabel: true
    },
    xAxis: {
      type: 'value',
      splitLine: { show: true, lineStyle: { color: 'rgba(148,163,184,0.06)' } },
      axisLabel: {
        formatter: (value) => {
          if (Math.abs(value) >= 10000) return (value / 10000) + '万';
          return value;
        }
      }
    },
    yAxis: {
      type: 'category',
      data: chartData.map(d => d.name),
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: '盈亏',
        type: 'bar',
        data: chartData.map(d => ({
          value: d.pnl,
          pnlPercent: d.pnlPercent,
          itemStyle: {
            color: d.pnl >= 0 ? profitColor : lossColor,
            borderRadius: [0, 4, 4, 0]
          }
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (params) => formatCurrency(params.value, 'CNY', true),
          color: '#94a3b8',
          fontSize: 10
        }
      }
    ]
  };
  
  chart.setOption(option);
  setupResize(chart);
  return chart;
}
