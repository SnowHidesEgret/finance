import * as echarts from 'echarts';
import { disposeChart, setupResize } from './theme.js';
import { formatCurrency } from '../utils/format.js';

export function renderPortfolioPie(container, data) {
  if (!container || !data || data.length === 0) return;
  
  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');
  
  const total = data.reduce((sum, item) => sum + item.value, 0);
  
  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        return `${params.name}<br/>${formatCurrency(params.value, 'CNY')} (${params.percent}%)`;
      }
    },
    legend: {
      bottom: '0%',
      left: 'center',
      type: 'scroll'
    },
    series: [
      {
        name: '持仓占比',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 8,
          borderColor: '#06080f',
          borderWidth: 2
        },
        label: {
          show: false,
          position: 'center'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: '18',
            fontWeight: 'bold',
            formatter: '{b}\n{d}%',
            color: '#f1f5f9'
          }
        },
        labelLine: {
          show: false
        },
        data: data
      }
    ]
  };
  
  chart.setOption(option);
  setupResize(chart);
  return chart;
}
