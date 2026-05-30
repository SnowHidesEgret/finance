import * as echarts from 'echarts';
import { disposeChart, setupResize } from './theme.js';
import { formatCurrency } from '../utils/format.js';

export function renderCostBar(container, data) {
  if (!container || !data || data.length === 0) return;
  
  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');
  
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
          本金: ${formatCurrency(item.value, 'CNY')}
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
        name: '本金',
        type: 'bar',
        data: chartData.map(d => ({
          value: d.cost,
          itemStyle: {
            color: '#3b82f6', // Use a primary blue color for cost
            borderRadius: [0, 4, 4, 0]
          }
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (params) => formatCurrency(params.value, 'CNY'),
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
