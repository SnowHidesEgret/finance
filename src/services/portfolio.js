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
 * @param {Object} [quote=null] - 当前行情对象
 * @returns {Object} 盈亏计算结果
 */
export function calculatePositionPnL(position, currentPrice, rateToCNY, quote = null) {
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
  
  // 自然月本月收益率 (MTD)
  const now = new Date();
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const posOpenYMD = getYYYYMMDD(position.open_date);
  const isBoughtBeforeMonth = posOpenYMD && posOpenYMD < currentMonthStart;
  const mtdPrice = quote?.mtdPrice || quote?.mtd_price || (isBoughtBeforeMonth ? (quote?.prev_close || quote?.prevClose) : null);
  const mtdBasePrice = isBoughtBeforeMonth ? (mtdPrice || open_price) : open_price;
  const mtdBaseNative = quantity * mtdBasePrice;
  const mtdPnLNative = (currentPrice - mtdBasePrice) * quantity;
  const mtdPnLCNY = toFixed2(mtdPnLNative * currentRate);
  const mtdBaseCNY = toFixed2(mtdBaseNative * currentRate);
  const monthlyReturn = mtdBaseCNY > 0 ? toFixed2((mtdPnLCNY / mtdBaseCNY) * 100) : 0;
  
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
    mtdPnLCNY,
    mtdBaseCNY,
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
  
  // 自然月本月收益率 (MTD)
  const now = new Date();
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const closeYMD = getYYYYMMDD(close_date || new Date());
  const isClosedThisMonth = closeYMD && closeYMD >= currentMonthStart;
  const openYMD = getYYYYMMDD(open_date);
  const isBoughtBeforeMonth = openYMD && openYMD < currentMonthStart;
  
  let monthlyReturn = 0;
  if (isClosedThisMonth) {
    monthlyReturn = realizedPnLPercent;
  }
  
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

/** Standardize date string to YYYY-MM-DD for date comparison */
function getYYYYMMDD(dateVal) {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
  }
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Get today's YYYY-MM-DD date formatted in the market's local timezone */
function getMarketTodayYMD(market = 'A_SHARE', now = new Date()) {
  let timeZone = 'Asia/Shanghai';
  if (market === 'US') timeZone = 'America/New_York';
  else if (market === 'SWISS') timeZone = 'Europe/Zurich';
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(now);
  } catch {
    return getYYYYMMDD(now);
  }
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
  let portfolioTotalMtdPnL = 0;
  
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
      totalMtdPnL: 0,
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
    
    const pnl = calculatePositionPnL(pos, currentPrice, rateToCNY, quote);
    
    // 日盈亏 (对于当期/买入日及之后的持仓，以买入开仓价格 open_price 为基准)
    const effectiveQuoteDate = quote?.marketDate || getMarketTodayYMD(pos.market, new Date());
    const posOpenYMD = getYYYYMMDD(pos.open_date);
    const isBoughtToday = posOpenYMD && posOpenYMD >= effectiveQuoteDate;
    const prevClose = quote?.prev_close || quote?.prevClose || currentPrice;
    const basePrice = isBoughtToday ? pos.open_price : prevClose;
    const dayChange = (currentPrice - basePrice) * pos.quantity * rateToCNY;

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
    portfolioTotalMtdPnL += (pnl.mtdPnLCNY || 0);
    
    // 市场汇总
    if (marketSummaries[pos.market]) {
      const ms = marketSummaries[pos.market];
      ms.totalValue += pnl.marketValueCNY;
      ms.totalCost += pnl.costCNY;
      ms.totalPnL += pnl.pnlCNY;
      ms.totalMtdPnL += (pnl.mtdPnLCNY || 0);
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
  
  // 计算市场占比与月收益率
  for (const ms of Object.values(marketSummaries)) {
    ms.totalValue = toFixed2(ms.totalValue);
    ms.totalCost = toFixed2(ms.totalCost);
    ms.totalPnL = toFixed2(ms.totalPnL);
    ms.pnlPercent = ms.totalCost > 0 ? toFixed2((ms.totalPnL / ms.totalCost) * 100) : 0;
    ms.weight = totalValueCNY > 0 ? toFixed2((ms.totalValue / totalValueCNY) * 100) : 0;
    // 加权平均持仓天数 → 年化收益率
    const avgDays = ms.totalValue > 0 ? Math.max(1, Math.round(ms.totalWeightedDays / ms.totalValue)) : 1;
    ms.avgHoldingDays = avgDays;
    ms.annualizedReturn = toFixed2((ms.pnlPercent / avgDays) * 365);
    
    // 自然月本月收益率 (MTD)
    const mtdCapitalBase = ms.totalValue - ms.totalMtdPnL;
    ms.monthlyReturn = mtdCapitalBase > 0 ? toFixed2((ms.totalMtdPnL / mtdCapitalBase) * 100) : 0;
    ms.mtdPercent = ms.monthlyReturn;
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
  
  // 组合级自然月本月收益率 (MTD)
  const totalMtdCapitalBase = totalValueCNY - portfolioTotalMtdPnL;
  const totalMonthlyReturn = totalMtdCapitalBase > 0
    ? toFixed2((portfolioTotalMtdPnL / totalMtdCapitalBase) * 100)
    : 0;
  
  return {
    totalValueCNY: toFixed2(totalValueCNY),
    totalCostCNY: toFixed2(totalCostCNY),
    totalPnLCNY,
    totalPnLPercent,
    totalDayPnL: toFixed2(totalDayPnL),
    totalAvgHoldingDays,
    totalAnnualizedReturn,
    totalMonthlyReturn,
    portfolioMtdPnlCNY: toFixed2(portfolioTotalMtdPnL),
    portfolioMtdPercent: totalMonthlyReturn,
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
