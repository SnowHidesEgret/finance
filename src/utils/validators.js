/**
 * StockVault — 数据验证器
 */

import { MARKETS, TRADE_TYPES, SECTORS } from './constants.js';

/**
 * 验证持仓数据
 * @param {Object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePosition(data) {
  const errors = [];
  
  if (!data.symbol?.trim()) errors.push('股票代码不能为空');
  if (!data.name?.trim()) errors.push('股票名称不能为空');
  if (!MARKETS[data.market]) errors.push('请选择有效的市场');
  
  if (!data.open_date) {
    errors.push('开仓日期不能为空');
  } else if (new Date(data.open_date) > new Date()) {
    errors.push('开仓日期不能是未来日期');
  }
  
  if (!data.open_price || data.open_price <= 0) errors.push('开仓价必须大于 0');
  if (!data.quantity || data.quantity <= 0) errors.push('数量必须大于 0');
  if (data.commission != null && data.commission < 0) errors.push('手续费不能为负');
  
  return { valid: errors.length === 0, errors };
}

/**
 * 验证平仓数据
 * @param {Object} data
 * @param {Object} position - 原持仓记录
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateClosePosition(data, position) {
  const errors = [];
  
  if (!data.close_price || data.close_price <= 0) errors.push('平仓价必须大于 0');
  
  if (!data.close_date) {
    errors.push('平仓日期不能为空');
  } else {
    if (new Date(data.close_date) > new Date()) {
      errors.push('平仓日期不能是未来日期');
    }
    if (position && new Date(data.close_date) < new Date(position.open_date)) {
      errors.push('平仓日期不能早于开仓日期');
    }
  }
  
  if (data.close_commission != null && data.close_commission < 0) {
    errors.push('平仓手续费不能为负');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * 验证交易记录
 * @param {Object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTrade(data) {
  const errors = [];
  
  if (!data.symbol?.trim()) errors.push('股票代码不能为空');
  if (!data.name?.trim()) errors.push('股票名称不能为空');
  if (!MARKETS[data.market]) errors.push('请选择有效的市场');
  if (!Object.values(TRADE_TYPES).includes(data.trade_type)) errors.push('交易类型无效');
  if (!data.price || data.price <= 0) errors.push('价格必须大于 0');
  if (!data.quantity || data.quantity <= 0) errors.push('数量必须大于 0');
  if (!data.trade_date) errors.push('交易日期不能为空');
  
  return { valid: errors.length === 0, errors };
}
