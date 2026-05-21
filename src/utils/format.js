/**
 * StockVault — 数字/货币/日期格式化工具
 */

/**
 * 格式化货币金额
 * @param {number} amount - 金额
 * @param {string} [currency='CNY'] - 货币代码
 * @param {boolean} [showSign=false] - 是否显示正号
 * @returns {string} 格式化后的金额
 */
export function formatCurrency(amount, currency = 'CNY', showSign = false) {
  if (amount == null || isNaN(amount)) return '--';
  
  const abs = Math.abs(amount);
  let formatted;
  
  const symbols = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };
  const symbol = symbols[currency] || currency + ' ';
  
  if (abs >= 1e8) {
    formatted = `${symbol}${(amount / 1e8).toFixed(2)}亿`;
  } else if (abs >= 1e4) {
    formatted = `${symbol}${(amount / 1e4).toFixed(2)}万`;
  } else {
    formatted = `${symbol}${amount.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  
  if (showSign && amount > 0) formatted = '+' + formatted;
  return formatted;
}

/**
 * 格式化纯数字（无货币符号）
 * @param {number} num
 * @param {number} [decimals=2]
 * @param {boolean} [showSign=false]
 * @returns {string}
 */
export function formatNumber(num, decimals = 2, showSign = false) {
  if (num == null || isNaN(num)) return '--';
  
  const formatted = num.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  
  if (showSign && num > 0) return '+' + formatted;
  return formatted;
}

/**
 * 格式化百分比
 * @param {number} value - 百分比值 (例如 5.23 表示 5.23%)
 * @param {boolean} [showSign=true]
 * @returns {string}
 */
export function formatPercent(value, showSign = true) {
  if (value == null || isNaN(value)) return '--';
  
  const formatted = Math.abs(value).toFixed(2) + '%';
  if (showSign) {
    if (value > 0) return '+' + formatted;
    if (value < 0) return '-' + formatted;
  }
  return formatted;
}

/**
 * 格式化日期
 * @param {string|Date} date
 * @param {string} [format='YYYY-MM-DD']
 * @returns {string}
 */
export function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '--';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '--';
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  switch (format) {
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'YYYY-MM-DD HH:mm':
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    case 'MM-DD':
      return `${month}-${day}`;
    case 'relative':
      return formatRelativeDate(d);
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * 相对时间格式化
 * @param {Date} date
 * @returns {string}
 */
function formatRelativeDate(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  return formatDate(date);
}

/**
 * 格式化股数
 * @param {number} quantity
 * @returns {string}
 */
export function formatQuantity(quantity) {
  if (quantity == null) return '--';
  if (Number.isInteger(quantity)) return quantity.toLocaleString('zh-CN');
  return quantity.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  });
}

/**
 * 计算持仓天数
 * @param {string} openDate
 * @param {string} [closeDate]
 * @returns {number}
 */
export function calcHoldingDays(openDate, closeDate) {
  const start = new Date(openDate);
  const end = closeDate ? new Date(closeDate) : new Date();
  return Math.max(1, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
}

/**
 * 安全的浮点数运算（保留2位小数）
 * @param {number} num
 * @returns {number}
 */
export function toFixed2(num) {
  return Math.round(num * 100) / 100;
}

/**
 * 获取盈亏的 CSS 类
 * @param {number} value
 * @returns {string} 'profit' | 'loss' | 'neutral'
 */
export function getPnLClass(value) {
  if (value > 0) return 'profit';
  if (value < 0) return 'loss';
  return 'neutral';
}

/**
 * 生成 UUID v4
 * @returns {string}
 */
export function generateId() {
  return crypto.randomUUID();
}
