import * as echarts from 'echarts';

let themeRegistered = false;

export function initTheme() {
  if (themeRegistered) return;
  
  const colorPalette = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', 
    '#10b981', '#3b82f6', '#ef4444', '#06b6d4'
  ];

  const theme = {
    color: colorPalette,
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: 'Inter, sans-serif'
    },
    title: {
      textStyle: { color: '#f1f5f9' },
      subtextStyle: { color: '#94a3b8' }
    },
    line: {
      itemStyle: { borderWidth: 2 },
      lineStyle: { width: 2 },
      symbolSize: 4,
      symbol: 'circle',
      smooth: true
    },
    bar: {
      itemStyle: { barBorderWidth: 0, barBorderColor: '#ccc' }
    },
    pie: {
      itemStyle: { borderWidth: 0, borderColor: '#ccc' }
    },
    scatter: {
      itemStyle: { borderWidth: 0, borderColor: '#ccc' }
    },
    boxplot: {
      itemStyle: { borderWidth: 1, borderColor: '#ccc' }
    },
    parallel: {
      itemStyle: { borderWidth: 0, borderColor: '#ccc' }
    },
    sankey: {
      itemStyle: { borderWidth: 0, borderColor: '#ccc' }
    },
    funnel: {
      itemStyle: { borderWidth: 0, borderColor: '#ccc' }
    },
    gauge: {
      itemStyle: { borderWidth: 0, borderColor: '#ccc' }
    },
    candlestick: {
      itemStyle: {
        color: '#ef4444',
        color0: '#10b981',
        borderColor: '#ef4444',
        borderColor0: '#10b981',
        borderWidth: 1
      }
    },
    graph: {
      itemStyle: { borderWidth: 0, borderColor: '#ccc' },
      lineStyle: { width: 1, color: '#aaa' },
      symbolSize: 4,
      symbol: 'circle',
      smooth: true,
      color: colorPalette,
      label: { color: '#f1f5f9' }
    },
    map: {
      itemStyle: {
        areaColor: '#eee',
        borderColor: '#444',
        borderWidth: 0.5
      },
      label: { color: '#000' },
      emphasis: {
        itemStyle: { areaColor: 'rgba(255,215,0,0.8)', borderColor: '#444', borderWidth: 1 },
        label: { color: 'rgb(100,0,0)' }
      }
    },
    categoryAxis: {
      axisLine: { show: true, lineStyle: { color: '#1e293b' } },
      axisTick: { show: true, lineStyle: { color: '#1e293b' } },
      axisLabel: { show: true, color: '#94a3b8' },
      splitLine: { show: false, lineStyle: { color: ['rgba(148,163,184,0.06)'] } },
      splitArea: { show: false, areaStyle: { color: ['rgba(250,250,250,0.3)','rgba(200,200,200,0.3)'] } }
    },
    valueAxis: {
      axisLine: { show: false, lineStyle: { color: '#1e293b' } },
      axisTick: { show: false, lineStyle: { color: '#1e293b' } },
      axisLabel: { show: true, color: '#94a3b8' },
      splitLine: { show: true, lineStyle: { color: ['rgba(148,163,184,0.06)'] } },
      splitArea: { show: false, areaStyle: { color: ['rgba(250,250,250,0.3)','rgba(200,200,200,0.3)'] } }
    },
    logAxis: {
      axisLine: { show: false, lineStyle: { color: '#1e293b' } },
      axisTick: { show: false, lineStyle: { color: '#1e293b' } },
      axisLabel: { show: true, color: '#94a3b8' },
      splitLine: { show: true, lineStyle: { color: ['rgba(148,163,184,0.06)'] } },
      splitArea: { show: false, areaStyle: { color: ['rgba(250,250,250,0.3)','rgba(200,200,200,0.3)'] } }
    },
    timeAxis: {
      axisLine: { show: true, lineStyle: { color: '#1e293b' } },
      axisTick: { show: true, lineStyle: { color: '#1e293b' } },
      axisLabel: { show: true, color: '#94a3b8' },
      splitLine: { show: false, lineStyle: { color: ['rgba(148,163,184,0.06)'] } },
      splitArea: { show: false, areaStyle: { color: ['rgba(250,250,250,0.3)','rgba(200,200,200,0.3)'] } }
    },
    toolbox: {
      iconStyle: { borderColor: '#999' },
      emphasis: { iconStyle: { borderColor: '#666' } }
    },
    legend: { textStyle: { color: '#94a3b8' } },
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.95)',
      borderColor: 'rgba(148,163,184,0.1)',
      textStyle: { color: '#f1f5f9' },
      axisPointer: {
        lineStyle: { color: '#1e293b', width: 1 },
        crossStyle: { color: '#1e293b', width: 1 }
      }
    },
    timeline: {
      lineStyle: { color: '#293c55', width: 1 },
      itemStyle: { color: '#293c55', borderWidth: 1 },
      controlStyle: { color: '#293c55', borderColor: '#293c55', borderWidth: 0.5 },
      checkpointStyle: { color: '#e43c59', borderColor: 'rgba(194,53,49, 0.5)' },
      label: { color: '#293c55' },
      emphasis: {
        itemStyle: { color: '#a9334c' },
        controlStyle: { color: '#293c55', borderColor: '#293c55', borderWidth: 0.5 },
        label: { color: '#293c55' }
      }
    },
    visualMap: { color: ['#bf444c', '#d88273', '#f6efa6'] },
    dataZoom: {
      backgroundColor: 'rgba(47,69,84,0)',
      dataBackgroundColor: 'rgba(47,69,84,0.3)',
      fillerColor: 'rgba(167,183,204,0.4)',
      handleColor: '#a7b7cc',
      handleSize: '100%',
      textStyle: { color: '#333' }
    },
    markPoint: {
      label: { color: '#eee' },
      emphasis: { label: { color: '#eee' } }
    }
  };

  echarts.registerTheme('stockvault', theme);
  themeRegistered = true;
}

export function disposeChart(container) {
  if (!container) return;
  const instance = echarts.getInstanceByDom(container);
  if (instance) {
    instance.dispose();
  }
}

export function setupResize(chart) {
  const handler = () => chart.resize();
  window.addEventListener('resize', handler);
  // Store the handler on the instance to remove it later if needed, but typically ok for SPA if container stays
  chart.__resizeHandler = handler;
}
