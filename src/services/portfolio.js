/**
 * StockVault — 持仓计算引擎
 * 核心盈亏计算、指标统计、组合分析
 */

import { toFixed2 } from '../utils/format.js';
import { MARKETS } from '../utils/constants.js';

/**
 * 计算单个持仓的盈亏数据
 * @param {Object} position - 持仓记录
 * @param {number} currentPrice - 当前价格（原始货币）
 * @param {number} rateToCNY - 当前汇率（1单位外币 = ? CNY）
 * @returns {Object} 盈亏计算结果
 */
export function calculatePositionPnL(position, currentPrice, rateToCNY) {
  const {
    open_price, quantity, commission = 0,
    open_rate_to_cny, currency
  } = position;
  
  const currentRate = currency === 'CNY' ? 1 : rateToCNY;
  const openRate = currentRate; // 按实时汇率计算，忽略开仓时的历史汇率
  
  // 成本 (CNY)
  const costInOriginal = open_price * quantity + commission;
  const costCNY = toFixed2(costInOriginal * openRate);
  
  // 市值 (CNY)
  const marketValueOriginal = currentPrice * quantity;
  const marketValueCNY = toFixed2(marketValueOriginal * currentRate);
  
  // 浮动盈亏 (CNY)
  const pnlCNY = toFixed2(marketValueCNY - costCNY);
  
  // 盈亏比例 (%)
  const pnlPercent = costCNY !== 0 ? toFixed2((pnlCNY / costCNY) * 100) : 0;
  
  // 持仓天数
  const holdingDays = Math.max(1, Math.floor(
    (new Date() - new Date(position.open_date)) / (1000 * 60 * 60 * 24)
  ));
  
  // 年化收益率 (%)
  const annualizedReturn = toFixed2((pnlPercent / holdingDays) * 365);
  const monthlyReturn = toFixed2((pnlPercent / holdingDays) * 30);
  
  return {
    costOriginal: toFixed2(costInOriginal),
    costCNY,
    marketValueOriginal: toFixed2(marketValueOriginal),
    marketValueCNY,
    pnlCNY,
    pnlPercent,
    holdingDays,
    annualizedReturn,
    monthlyReturn,
    currentPrice,
    currentRate
  };
}

/**
 * 计算已平仓持仓的实际盈亏
 * @param {Object} position - 已平仓持仓
 * @returns {Object} 实际盈亏
 */
export function calculateClosedPnL(position, currentRateToCny = null) {
  const {
    open_price, close_price, quantity,
    commission = 0, close_commission = 0,
    open_rate_to_cny, close_rate_to_cny,
    open_date, close_date
  } = position;
  
  if (!close_price) return null;
  
  const openRate = currentRateToCny || open_rate_to_cny || 1;
  const closeRate = currentRateToCny || close_rate_to_cny || openRate;
  
  const costCNY = toFixed2((open_price * quantity + commission) * openRate);
  const proceedsCNY = toFixed2((close_price * quantity - close_commission) * closeRate);
  const realizedPnL = toFixed2(proceedsCNY - costCNY);
  const realizedPnLPercent = costCNY !== 0 ? toFixed2((realizedPnL / costCNY) * 100) : 0;
  
  // 持仓天数与收益率
  const holdingDays = Math.max(1, Math.floor(
    (new Date(close_date || new Date()) - new Date(open_date)) / (1000 * 60 * 60 * 24)
  ));
  const annualizedReturn = toFixed2((realizedPnLPercent / holdingDays) * 365);
  const monthlyReturn = toFixed2((realizedPnLPercent / holdingDays) * 30);
  
  return {
    costCNY,
    proceedsCNY,
    realizedPnL,
    realizedPnLPercent,
    holdingDays,
    annualizedReturn,
    monthlyReturn
  };
}

/**
 * 计算投资组合汇总
 * @param {Array} positions - 持仓列表
 * @param {Map<string, Object>} quotes - 行情数据 Map<symbol, quote>
 * @param {Object} rates - 汇率对象 { USD: rateToCNY, HKD: ..., CHF: ... }
 * @returns {Object} 组合汇总
 */
export function calculatePortfolioSummary(positions, quotes, rates) {
  let totalValueCNY = 0;
  let totalCostCNY = 0;
  let totalDayPnL = 0;
  
  const positionDetails = [];
  const marketSummaries = {};
  const sectorSummaries = {};
  const currencyExposure = { CNY: 0, USD: 0, HKD: 0, CHF: 0 };
  
  // 初始化市场汇总
  for (const marketId of Object.keys(MARKETS)) {
    marketSummaries[marketId] = {
      market: marketId,
      ...MARKETS[marketId],
      totalValue: 0,
      totalCost: 0,
      totalPnL: 0,
      positionCount: 0,
      totalWeightedDays: 0,
      positions: []
    };
  }
  
  for (const pos of positions) {
    if (pos.status !== 'OPEN') continue;
    
    const quote = quotes.get(pos.symbol);
    const currentPrice = quote?.price || pos.open_price;
    const currency = pos.currency || MARKETS[pos.market]?.currency || 'CNY';
    
    // 汇率：1 单位外币 = ? CNY
    let rateToCNY = 1;
    if (currency !== 'CNY' && rates[currency]) {
      rateToCNY = 1 / rates[currency]; // rates 是以 CNY 为基准的
    }
    
    const pnl = calculatePositionPnL(pos, currentPrice, rateToCNY);
    
    // 日盈亏
    const prevClose = quote?.prev_close || currentPrice;
    const dayChange = (currentPrice - prevClose) * pos.quantity * rateToCNY;
    
    const detail = {
      ...pos,
      ...pnl,
      dayPnLCNY: toFixed2(dayChange),
      weight: 0 // 稍后计算
    };
    
    positionDetails.push(detail);
    
    totalValueCNY += pnl.marketValueCNY;
    totalCostCNY += pnl.costCNY;
    totalDayPnL += dayChange;
    
    // 市场汇总
    if (marketSummaries[pos.market]) {
      const ms = marketSummaries[pos.market];
      ms.totalValue += pnl.marketValueCNY;
      ms.totalCost += pnl.costCNY;
      ms.totalPnL += pnl.pnlCNY;
      ms.positionCount++;
      ms.totalWeightedDays += pnl.holdingDays * pnl.marketValueCNY;
      ms.positions.push(detail);
    }
    
    // 行业汇总
    const sector = pos.sector || 'OTHER';
    if (!sectorSummaries[sector]) {
      sectorSummaries[sector] = { totalValue: 0, totalPnL: 0, count: 0 };
    }
    sectorSummaries[sector].totalValue += pnl.marketValueCNY;
    sectorSummaries[sector].totalPnL += pnl.pnlCNY;
    sectorSummaries[sector].count++;
    
    // 货币敞口
    currencyExposure[currency] = (currencyExposure[currency] || 0) + pnl.marketValueCNY;
  }
  
  // 计算权重
  for (const detail of positionDetails) {
    detail.weight = totalValueCNY > 0
      ? toFixed2((detail.marketValueCNY / totalValueCNY) * 100)
      : 0;
  }
  
  // 计算市场占比
  for (const ms of Object.values(marketSummaries)) {
    ms.totalValue = toFixed2(ms.totalValue);
    ms.totalCost = toFixed2(ms.totalCost);
    ms.totalPnL = toFixed2(ms.totalPnL);
    ms.pnlPercent = ms.totalCost > 0 ? toFixed2((ms.totalPnL / ms.totalCost) * 100) : 0;
    ms.weight = totalValueCNY > 0 ? toFixed2((ms.totalValue / totalValueCNY) * 100) : 0;
    // 加权平均持仓天数 → 年化 / 月收益率
    const avgDays = ms.totalValue > 0 ? Math.max(1, Math.round(ms.totalWeightedDays / ms.totalValue)) : 1;
    ms.avgHoldingDays = avgDays;
    ms.annualizedReturn = toFixed2((ms.pnlPercent / avgDays) * 365);
    ms.monthlyReturn = toFixed2((ms.pnlPercent / avgDays) * 30);
  }
  
  const totalPnLCNY = toFixed2(totalValueCNY - totalCostCNY);
  const totalPnLPercent = totalCostCNY > 0 ? toFixed2((totalPnLCNY / totalCostCNY) * 100) : 0;
  
  // 组合级加权平均持仓天数
  let totalWeightedDays = 0;
  for (const detail of positionDetails) {
    totalWeightedDays += detail.holdingDays * detail.marketValueCNY;
  }
  const totalAvgHoldingDays = totalValueCNY > 0 ? Math.max(1, Math.round(totalWeightedDays / totalValueCNY)) : 1;
  const totalAnnualizedReturn = toFixed2((totalPnLPercent / totalAvgHoldingDays) * 365);
  const totalMonthlyReturn = toFixed2((totalPnLPercent / totalAvgHoldingDays) * 30);
  
  return {
    totalValueCNY: toFixed2(totalValueCNY),
    totalCostCNY: toFixed2(totalCostCNY),
    totalPnLCNY,
    totalPnLPercent,
    totalDayPnL: toFixed2(totalDayPnL),
    totalAvgHoldingDays,
    totalAnnualizedReturn,
    totalMonthlyReturn,
    positionCount: positionDetails.length,
    positions: positionDetails,
    marketSummaries,
    sectorSummaries,
    currencyExposure
  };
}

/**
 * 计算组合的贝塔值（加权平均）
 * @param {Array} positions - 持仓列表（含 beta 和 marketValueCNY）
 * @param {number} totalValue - 组合总市值
 * @returns {number} 加权贝塔值
 */
export function calculatePortfolioBeta(positions, totalValue) {
  if (!totalValue || positions.length === 0) return 0;
  
  let weightedBeta = 0;
  let weightSum = 0;
  
  for (const pos of positions) {
    if (pos.beta != null && pos.marketValueCNY) {
      const weight = pos.marketValueCNY / totalValue;
      weightedBeta += pos.beta * weight;
      weightSum += weight;
    }
  }
  
  return weightSum > 0 ? toFixed2(weightedBeta / weightSum * weightSum) : 0;
}

/**
 * 按盈亏排名
 * @param {Array} positionDetails
 * @param {string} [sortBy='pnlCNY'] - 排序字段
 * @returns {Array}
 */
export function rankByPnL(positionDetails, sortBy = 'pnlCNY') {
  return [...positionDetails].sort((a, b) => b[sortBy] - a[sortBy]);
}
