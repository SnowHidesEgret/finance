import * as echarts from 'echarts';
import { disposeChart, setupResize } from './theme.js';
import { formatCurrency, formatPercent } from '../utils/format.js';
import { getColorScheme } from '../utils/colorScheme.js';

export function renderTreemap(container, data) {
  if (!container || !data || data.length === 0) return;
  
  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');
  
  const isCN = getColorScheme() === 'cn';
  const profitColor = isCN ? '#ef4444' : '#10b981';
  const lossColor = isCN ? '#10b981' : '#ef4444';
  
  // Transform data for treemap
  const treemapData = data.map(item => ({
    name: item.name,
    value: item.value,
    pnlPercent: item.pnlPercent,
    itemStyle: {
      color: item.pnlPercent >= 0 ? profitColor : lossColor,
      colorAlpha: Math.min(0.2 + Math.abs(item.pnlPercent) / 20 * 0.8, 1) // Opacity based on magnitude
    }
  }));

  const option = {
    tooltip: {
      formatter: function (info) {
        const { name, value, data } = info;
        if (!data || data.pnlPercent === undefined) return name;
        return `
          <div style="font-weight:bold;margin-bottom:4px;">${name}</div>
          市值: ${formatCurrency(value, 'CNY')}<br/>
          盈亏: ${formatPercent(data.pnlPercent)}
        `;
      }
    },
    series: [
      {
        type: 'treemap',
        data: treemapData,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true,
          formatter: function(params) {
            return `${params.name}\n${formatPercent(params.data.pnlPercent)}`;
          },
          color: '#fff',
          fontSize: 12
        },
        itemStyle: {
          borderColor: '#06080f',
          borderWidth: 2,
          gapWidth: 1,
          borderRadius: 6
        }
      }
    ]
  };
  
  chart.setOption(option);
  setupResize(chart);
  return chart;
}
