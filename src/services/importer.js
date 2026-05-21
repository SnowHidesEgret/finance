/**
 * StockVault — CSV/Excel 导入服务
 * 使用 SheetJS (xlsx) 在浏览器端解析文件
 */

import * as XLSX from 'xlsx';
import { MARKETS, TRADE_TYPES } from '../utils/constants.js';
import { generateId } from '../utils/format.js';

/**
 * 解析导入文件（CSV 或 Excel）
 * @param {File} file - 用户选择的文件
 * @returns {Promise<{headers: string[], rows: Array<Object>, raw: Array<Array>}>}
 */
export async function parseFile(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  
  // 取第一个工作表
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // 转为 JSON（带表头）
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
  
  if (jsonData.length < 2) {
    throw new Error('文件为空或只有表头，请确保包含数据行');
  }
  
  const headers = jsonData[0].map(h => String(h).trim());
  const rows = jsonData.slice(1)
    .filter(row => row.some(cell => cell != null && cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = row[i] != null ? String(row[i]).trim() : '';
      });
      return obj;
    });
  
  return { headers, rows, raw: jsonData };
}

/**
 * 字段映射表 — 支持中英文列名
 */
const FIELD_ALIASES = {
  symbol: ['symbol', '股票代码', '代码', 'ticker', 'code'],
  name: ['name', '股票名称', '名称', 'stock_name', '股票'],
  market: ['market', '市场', 'exchange', '交易所'],
  trade_type: ['trade_type', '交易类型', '类型', 'type', 'side', '方向', 'action'],
  price: ['price', '价格', '成交价', '买入价', '卖出价', 'trade_price'],
  quantity: ['quantity', '数量', '股数', 'qty', 'shares', 'volume'],
  trade_date: ['trade_date', '日期', '交易日期', 'date', 'trade_date'],
  commission: ['commission', '手续费', '佣金', 'fee', 'fees'],
  notes: ['notes', '备注', 'comment', 'memo', 'remark'],
  sector: ['sector', '行业', 'industry', '板块'],
  beta: ['beta', '贝塔', '贝塔值', 'β']
};

/**
 * 自动匹配列名
 * @param {string[]} headers - 文件中的列名
 * @returns {Object<string, string|null>} 映射结果 { fieldName: headerName }
 */
export function autoMapFields(headers) {
  const mapping = {};
  const lowerHeaders = headers.map(h => h.toLowerCase());
  
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let matched = null;
    for (const alias of aliases) {
      const idx = lowerHeaders.indexOf(alias.toLowerCase());
      if (idx !== -1) {
        matched = headers[idx];
        break;
      }
    }
    mapping[field] = matched;
  }
  
  return mapping;
}

/**
 * 市场名称归一化
 * @param {string} value
 * @returns {string|null}
 */
function normalizeMarket(value) {
  if (!value) return null;
  const v = value.toUpperCase().trim();
  
  const marketMap = {
    'A_SHARE': 'A_SHARE', 'A股': 'A_SHARE', 'A': 'A_SHARE',
    '沪': 'A_SHARE', '深': 'A_SHARE', 'SH': 'A_SHARE', 'SZ': 'A_SHARE',
    '上海': 'A_SHARE', '深圳': 'A_SHARE', 'CHINA': 'A_SHARE',
    'HK': 'HK', '港股': 'HK', '香港': 'HK', 'HONG KONG': 'HK', 'HKEX': 'HK',
    'US': 'US', '美股': 'US', '美国': 'US', 'NYSE': 'US', 'NASDAQ': 'US',
    'SWISS': 'SWISS', '瑞士': 'SWISS', 'SWX': 'SWISS', 'SIX': 'SWISS', 'CH': 'SWISS'
  };
  
  return marketMap[v] || null;
}

/**
 * 交易类型归一化
 * @param {string} value
 * @returns {string|null}
 */
function normalizeTradeType(value) {
  if (!value) return null;
  const v = value.toUpperCase().trim();
  
  const typeMap = {
    'BUY': 'BUY', '买入': 'BUY', '买': 'BUY', 'B': 'BUY', '开仓': 'BUY',
    'SELL': 'SELL', '卖出': 'SELL', '卖': 'SELL', 'S': 'SELL', '平仓': 'SELL'
  };
  
  return typeMap[v] || null;
}

/**
 * 验证并转换导入的行数据
 * @param {Array<Object>} rows - 原始行数据
 * @param {Object} fieldMapping - 字段映射
 * @returns {{ valid: Array, errors: Array<{row: number, field: string, message: string}> }}
 */
export function validateAndTransform(rows, fieldMapping) {
  const valid = [];
  const errors = [];
  
  rows.forEach((row, index) => {
    const rowNum = index + 2; // 表头为第1行
    const record = {};
    let hasError = false;
    
    const addError = (field, message) => {
      errors.push({ row: rowNum, field, message });
      hasError = true;
    };
    
    // 股票代码
    const symbol = row[fieldMapping.symbol]?.trim();
    if (!symbol) {
      addError('symbol', '股票代码不能为空');
    } else {
      record.symbol = symbol;
    }
    
    // 股票名称
    const name = row[fieldMapping.name]?.trim();
    if (!name) {
      addError('name', '股票名称不能为空');
    } else {
      record.name = name;
    }
    
    // 市场
    const marketRaw = row[fieldMapping.market]?.trim();
    const market = normalizeMarket(marketRaw);
    if (!market) {
      addError('market', `无法识别市场 "${marketRaw}"，请使用 A_SHARE/HK/US/SWISS`);
    } else {
      record.market = market;
      record.currency = MARKETS[market].currency;
    }
    
    // 交易类型
    const typeRaw = row[fieldMapping.trade_type]?.trim();
    const tradeType = normalizeTradeType(typeRaw);
    if (!tradeType) {
      addError('trade_type', `无法识别交易类型 "${typeRaw}"，请使用 BUY/SELL`);
    } else {
      record.trade_type = tradeType;
    }
    
    // 价格
    const price = parseFloat(row[fieldMapping.price]);
    if (isNaN(price) || price <= 0) {
      addError('price', '价格必须为正数');
    } else {
      record.price = price;
    }
    
    // 数量
    const quantity = parseFloat(row[fieldMapping.quantity]);
    if (isNaN(quantity) || quantity <= 0) {
      addError('quantity', '数量必须为正数');
    } else {
      record.quantity = quantity;
    }
    
    // 日期
    const dateStr = row[fieldMapping.trade_date]?.trim();
    if (!dateStr) {
      addError('trade_date', '交易日期不能为空');
    } else {
      const date = parseDate(dateStr);
      if (!date) {
        addError('trade_date', `无法解析日期 "${dateStr}"`);
      } else {
        record.trade_date = date;
      }
    }
    
    // 手续费（可选）
    if (fieldMapping.commission && row[fieldMapping.commission]) {
      const commission = parseFloat(row[fieldMapping.commission]);
      record.commission = isNaN(commission) ? 0 : Math.abs(commission);
    } else {
      record.commission = 0;
    }
    
    // 备注（可选）
    record.notes = fieldMapping.notes ? (row[fieldMapping.notes] || '') : '';
    
    // 行业（可选）
    record.sector = fieldMapping.sector ? (row[fieldMapping.sector] || '') : '';
    
    // Beta（可选）
    if (fieldMapping.beta && row[fieldMapping.beta]) {
      const beta = parseFloat(row[fieldMapping.beta]);
      record.beta = isNaN(beta) ? null : beta;
    }
    
    if (!hasError) {
      record.id = generateId();
      record.rate_to_cny = 1; // 将在提交时获取实时汇率
      valid.push(record);
    }
  });
  
  return { valid, errors };
}

/**
 * 解析日期字符串（支持多种格式）
 * @param {string} str
 * @returns {string|null} ISO 格式 YYYY-MM-DD
 */
function parseDate(str) {
  if (!str) return null;
  
  // 尝试 YYYY-MM-DD
  let match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  
  // 尝试 DD/MM/YYYY
  match = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  
  // 尝试 YYYY年MM月DD日
  match = str.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  
  // 尝试 Date 对象解析
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  
  return null;
}

/**
 * 生成 CSV 导入模板内容
 * @returns {string} CSV 文本
 */
export function generateTemplateCSV() {
  const headers = ['股票代码', '股票名称', '市场', '交易类型', '价格', '数量', '日期', '手续费', '备注', '行业', '贝塔值'];
  const example1 = ['600519.SHH', '贵州茅台', 'A股', '买入', '1850.00', '100', '2026-01-15', '5.00', '长期持有', '消费', '0.85'];
  const example2 = ['AAPL', 'Apple Inc.', '美股', 'BUY', '198.50', '50', '2026-02-01', '1.00', '', '科技', '1.20'];
  const example3 = ['0700.HKG', '腾讯控股', '港股', '买入', '380.00', '200', '2026-03-10', '50.00', '', '科技', '1.10'];
  
  return [headers, example1, example2, example3]
    .map(row => row.join(','))
    .join('\n');
}

/**
 * 导出数据为 CSV 文件并下载
 * @param {Array<Object>} data - 数据数组
 * @param {string[]} columns - 列名
 * @param {string} filename - 文件名
 */
export function downloadCSV(data, columns, filename) {
  const rows = [columns.join(',')];
  
  for (const item of data) {
    const row = columns.map(col => {
      const val = item[col];
      if (val == null) return '';
      const str = String(val);
      // 包含逗号或换行时用引号包裹
      return str.includes(',') || str.includes('\n') ? `"${str}"` : str;
    });
    rows.push(row.join(','));
  }
  
  const bom = '\uFEFF'; // UTF-8 BOM for Excel compatibility
  const blob = new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
