import { get } from './api.js';

/**
 * 将对象数组转换为 CSV 字符串
 * @param {Array} data 
 * @param {Array<{key: string, label: string}>} columns 
 */
function toCSV(data, columns) {
  const header = columns.map(col => `"${col.label.replace(/"/g, '""')}"`).join(',');
  
  const rows = data.map(row => {
    return columns.map(col => {
      let val = row[col.key];
      if (val === null || val === undefined) {
        val = '';
      }
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',');
  });
  
  return [header, ...rows].join('\n');
}

/**
 * 触发文件下载
 * @param {string} csvContent 
 * @param {string} filename 
 */
function downloadCSV(csvContent, filename) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportPositionsCSV() {
  try {
    const data = await get('/api/positions');
    
    // 尽量全面的导出字段
    const columns = [
      { key: 'id', label: '持仓ID' },
      { key: 'symbol', label: '代码' },
      { key: 'name', label: '名称' },
      { key: 'market', label: '市场' },
      { key: 'currency', label: '货币' },
      { key: 'open_date', label: '开仓日期' },
      { key: 'open_price', label: '开仓均价' },
      { key: 'open_rate_to_cny', label: '开仓汇率' },
      { key: 'quantity', label: '持仓数量' },
      { key: 'commission', label: '总佣金' },
      { key: 'status', label: '状态' },
      { key: 'sector', label: '板块/行业' },
      { key: 'beta', label: 'Beta' },
      { key: 'notes', label: '备注' },
      { key: 'tags', label: '标签' },
      { key: 'created_at', label: '创建时间' },
      { key: 'updated_at', label: '最后更新时间' }
    ];
    
    const csv = toCSV(data, columns);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSV(csv, `positions_export_${dateStr}.csv`);
    return true;
  } catch (error) {
    console.error('导出持仓失败', error);
    throw error;
  }
}

export async function exportTradesCSV(fromDate, toDate) {
  try {
    const params = {};
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;
    
    const data = await get('/api/trades', params);
    
    // 尽量全面的导出字段
    const columns = [
      { key: 'id', label: '交易记录ID' },
      { key: 'position_id', label: '关联持仓ID' },
      { key: 'symbol', label: '代码' },
      { key: 'name', label: '名称' },
      { key: 'market', label: '市场' },
      { key: 'trade_type', label: '交易类型' },
      { key: 'price', label: '成交价格' },
      { key: 'quantity', label: '成交数量' },
      { key: 'commission', label: '佣金' },
      { key: 'currency', label: '货币' },
      { key: 'rate_to_cny', label: '成交汇率' },
      { key: 'trade_date', label: '交易日期' },
      { key: 'notes', label: '备注' },
      { key: 'created_at', label: '创建时间' }
    ];
    
    const csv = toCSV(data, columns);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSV(csv, `trades_export_${dateStr}.csv`);
    return true;
  } catch (error) {
    console.error('导出交易失败', error);
    throw error;
  }
}

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF' };

export async function exportOpenPositionsSummaryCSV() {
  try {
    const summary = await get('/api/summary');
    const data = summary?.positions || [];
    const totalValueCNY = summary?.totalValueCNY || 0;
    const totalPnlCNY = summary?.totalPnlCNY || 0;
    const totalPnlPercent = summary?.totalPnlPercent || 0;

    // Filter only OPEN positions
    const openPositions = data.filter(p => p.status === 'OPEN');

    const headers = ['名称', '代码', '数量', '均价', '当前价格', '市值', '净盈亏%', '净收益/亏损'];
    const headerRow = headers.map(h => `"${h}"`).join(',');

    const rows = openPositions.map(pos => {
      const qty = pos.quantity || 0;
      const openPrice = pos.open_price || 0;
      const curPrice = pos.currentPrice || 0;

      // Local market value
      const marketVal = curPrice * qty;
      const curSymbol = CURRENCY_SYMBOL[pos.currency] || '';
      const formattedMarketVal = `${curSymbol}${marketVal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Return %
      const pnlPct = pos.pnlPercent || 0;
      const formattedPnlPct = `${pnlPct.toFixed(2)}%`;

      // Return CNY
      const pnlCNY = pos.pnlCNY || 0;
      const absPnlCNYStr = Math.abs(pnlCNY).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formattedPnlCNY = pnlCNY < 0 ? `¥-${absPnlCNYStr}` : `¥${absPnlCNYStr}`;

      return [
        `"${pos.name || ''}"`,
        `"${pos.symbol || ''}"`,
        qty,
        openPrice,
        curPrice,
        `"${formattedMarketVal}"`,
        `"${formattedPnlPct}"`,
        `"${formattedPnlCNY}"`
      ].join(',');
    });

    // Summary rows
    const formattedTotalVal = `¥${totalValueCNY.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const absTotalPnlCNYStr = Math.abs(totalPnlCNY).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedTotalPnl = totalPnlCNY < 0 ? `¥-${absTotalPnlCNYStr}` : `¥${absTotalPnlCNYStr}`;
    const formattedTotalPnlPct = `${totalPnlPercent.toFixed(2)}%`;
    
    const summaryRow1 = [`"市值"`, `"${formattedTotalVal}"`, '""', '""', '""', '""', '""', '""'].join(',');
    const summaryRow2 = [`"收益/亏损"`, `"${formattedTotalPnl} / ${formattedTotalPnlPct}"`, '""', '""', '""', '""', '""', '""'].join(',');

    const csvContent = [headerRow, ...rows, summaryRow1, summaryRow2].join('\n');
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSV(csvContent, `open_positions_summary_${dateStr}.csv`);
    return true;
  } catch (error) {
    console.error('导出未平仓头寸汇总失败', error);
    throw error;
  }
}

