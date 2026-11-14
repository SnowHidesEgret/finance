/**
 * StockVault — 深度图表分析页
 * 涵盖：
 * 1. 核心复盘 KPI 卡片（整体胜率、盈亏比、最大回撤、加权持仓周期 & 年化）
 * 2. 多维资产与收益走势（市值vs成本 / 累计盈亏 / YTD走势 + 分市场 + 时间跨度 + 回撤峰值栏）
 * 3. 多维市场收益对比（YTD / 本月MTD / 累计盈亏 / 年化%）
 * 4. 盈亏贡献瀑布图（累计 / YTD / 本月MTD 个股归因瀑布图）
 * 5. 持仓周期 × 收益率 × 市值 四象限气泡图（支持切换总收益/年化/YTD，点击查看逐笔明细）
 * 6. 交易胜率与盈亏结构复盘（双环图 + 盈亏比/极值统计面板，支持按标的 / 按逐笔批次切换）
 * 7. 月度收益热力日历矩阵（结合历史快照与当月实时 MTD）
 * 8. 月度交易资金流向与频次图（买入/卖出/净流入 CNY + 交易次数）
 * 9. 多币种成本 vs 市值敞口分析（CNY / USD / HKD / CHF）
 * 10. 持仓集中度帕累托图（CR3 / CR5 / HHI 风险评级）
 */

import * as echarts from 'echarts';
import { formatCurrency, formatPercent, getPnLClass, toFixed2 } from '../utils/format.js';
import { MARKETS } from '../utils/constants.js';
import { get } from '../services/api.js';
import { initTheme, disposeChart, setupResize } from '../charts/theme.js';
import { renderAssetTrend, computeTrendMetrics } from '../charts/assetTrend.js';
import { getColorScheme } from '../utils/colorScheme.js';
import { showActiveLotsModal } from './PositionsPage.js';

const MARKET_LABELS = {
  ALL: '🌐 全部市场',
  US: '🇺🇸 美股',
  HK: '🇭🇰 港股',
  A_SHARE: '🇨🇳 A股',
  SWISS: '🇨🇭 瑞士'
};

const CURRENCY_LABELS = {
  USD: '🇺🇸 USD 美元',
  HKD: '🇭🇰 HKD 港币',
  CNY: '🇨🇳 CNY 人民币',
  CHF: '🇨🇭 CHF 瑞郎'
};

/**
 * 指标含义与计算方式字典（用于鼠标悬停提示）
 */
const METRIC_HELP = {
  kpi_winrate: {
    title: '整体投资胜率',
    meaning: '衡量当前持仓与历史已平仓标的中，实现正收益的标的占比，反映选股与建仓的成功概率。',
    formula: '胜率 = 盈利标的数量 / 总标的数量 × 100%（含当前 OPEN 持仓与历史 CLOSED 平仓）'
  },
  kpi_pf: {
    title: '盈亏比 (Profit Factor)',
    meaning: '衡量“赚大亏小”能力的核心风控指标。数值 > 1 表示总盈利覆盖总亏损，> 2 通常代表优秀的盈亏控制。',
    formula: 'Profit Factor = ∑(盈利标的盈利额) / |∑(亏损标的亏损额)|；单笔均盈亏比 = 平均每笔盈利 / 平均每笔亏损'
  },
  kpi_mdd: {
    title: '近一年最大回撤 (Max Drawdown)',
    meaning: '统计周期内组合净值从历史最高点回落到后续最低点的最大幅度，衡量极端下行风险。',
    formula: '最大回撤率 = max((阶段峰值市值 - 随后低谷市值) / 阶段峰值市值) × 100%'
  },
  kpi_cr3: {
    title: '前三大重仓集中度 (CR3)',
    meaning: '前三大持仓市值占组合总市值的比例（当历史快照不足 2 天时自动展示），反映头寸集中风险。',
    formula: 'CR3 = (市值 Top 1 + Top 2 + Top 3) / 组合总市值 × 100%'
  },
  kpi_holding: {
    title: '加权持仓周期 & 组合年化',
    meaning: '按各持仓当前市值加权计算的平均持有天数，并将当前累计收益率年化，便于跨周期横向对比。',
    formula: '加权天数 = ∑(个股持仓天数 × 个股市值) / 总市值；年化收益率 = (累计收益率 / 加权持仓天数) × 365'
  },
  trend_chart: {
    title: '资产与收益净值走势',
    meaning: '追踪不同市场与时间窗口下的资产规模与真实收益变化，剔除加减仓本金干扰来观察收益曲线。',
    formula: '市值 vs 成本：每日快照市值与投入成本；累计盈亏 = 市值 - 成本；YTD 年内收益 = 年初至今净值盈亏'
  },
  trend_peak: {
    title: '区间峰值',
    meaning: '当前所选市场与时间跨度内，资产总市值达到的最高点及其对应日期。',
    formula: '区间峰值 = max(所选时间区间内每日快照 totalValueCNY)'
  },
  trend_mdd: {
    title: '区间最大回撤',
    meaning: '当前所选市场与时间跨度内，从局部最高点到其后最低点的最大净值回撤幅度与金额。',
    formula: '回撤金额 = 峰值市值 - 后续低谷市值；回撤率 = 回撤金额 / 峰值市值 × 100%'
  },
  trend_change: {
    title: '区间盈亏变动',
    meaning: '所选时间区间期末与期初累计盈亏的净增量，反映该时间段内的净赚钱效应。',
    formula: '变动额 = 期末累计盈亏 - 期初累计盈亏；变动率 = 变动额 / 期初市值 × 100%'
  },
  market_compare: {
    title: '各市场收益表现对比',
    meaning: '横向对比美股、港股、A股、瑞士四个市场的赚钱效率与累计贡献，辅助跨市场资金再平衡。',
    formula: 'YTD/MTD = 期间总盈亏 / (当前市值 - 期间总盈亏)；年化% = (市场累计收益率 / 市场加权持仓天数) × 365'
  },
  waterfall: {
    title: '盈亏归因瀑布图 (Waterfall)',
    meaning: '拆解当前组合总盈亏/YTD/MTD 到底由哪些核心个股拉动、哪些个股拖累，定位主要收益来源。',
    formula: '净收益合计 = Top 正贡献个股 + 其他持仓汇总 + Top 负贡献个股（均折算人民币 CNY）'
  },
  quadrant: {
    title: '持仓周期 × 收益率 四象限诊断',
    meaning: '以“平均持仓天数”和“0% 盈亏线”划分四象限，快速识别长线稳赢、短线高效、建仓观察与长线被套标的。',
    formula: 'X 轴 = 个股加权持仓天数；Y 轴 = 总收益率% / 年化% / YTD%；气泡面积 ∝ 当前持仓市值'
  },
  winrate_panel: {
    title: '胜率分布与盈亏结构复盘',
    meaning: '支持按“持仓标的”或“逐笔买入批次(Lots)”双粒度检验交易胜率，并对比在途浮盈与已平仓落袋盈亏。',
    formula: '总盈利 = ∑盈利项；总亏损 = ∑亏损项；均盈/均亏 = 各自总额 / 对应笔数'
  },
  stat_winrate: {
    title: '统计胜率',
    meaning: '在当前所选统计粒度（按标的或按逐笔买入批次）下，盈利项目数占总项目数的比例。',
    formula: '胜率 = 盈利数量 / (盈利数 + 亏损数 + 持平数) × 100%'
  },
  stat_avg_wl: {
    title: '平均单笔盈利 / 亏损',
    meaning: '对比平均每笔赚钱单的盈利额与亏钱单的亏损额，二者比值即“单笔均盈亏比”。',
    formula: '平均盈利 = 总盈利额 / 盈利笔数；平均亏损 = |总亏损额| / 亏损笔数'
  },
  stat_unrealized: {
    title: '在途浮动净盈亏',
    meaning: '当前所有尚未平仓（OPEN）的持仓按实时市价与实时汇率计算的净账面盈亏。',
    formula: '浮动净盈亏 = ∑(当前市值 CNY - 持仓成本 CNY)'
  },
  stat_realized: {
    title: '历史已平仓落袋盈亏',
    meaning: '所有已彻底清仓（CLOSED）的历史交易已经兑现的真实收益净值（已扣除买卖手续费）。',
    formula: '已实现盈亏 = ∑((平仓价 × 数量 - 卖出佣金) - (开仓价 × 数量 + 买入佣金)) × 汇率'
  },
  stat_best: {
    title: '最佳盈利贡献',
    meaning: '在当前统计粒度（标的或批次）中，贡献人民币绝对盈利金额最高的单项。',
    formula: 'Best = max(所有统计项的 pnlCNY)'
  },
  stat_worst: {
    title: '最大亏损拖累',
    meaning: '在当前统计粒度（标的或批次）中，造成人民币绝对亏损金额最大的单项。',
    formula: 'Worst = min(所有统计项的 pnlCNY < 0)'
  },
  monthly_matrix: {
    title: '月度收益日历矩阵',
    meaning: '以基金月报视角按自然月回溯全年收益节奏，识别季节性波动与连续回撤月份。',
    formula: '历史月 = (月末快照累计盈亏 - 上月末累计盈亏) / 月初市值；当月实时 = 当月 MTD 收益 / (当前市值 - MTD 收益)'
  },
  monthly_cell_live: {
    title: '本月实时 MTD 收益',
    meaning: '从本月 1 日至今日的自然月实时收益率与盈亏额，包含在途持仓当月波动及本月已平仓损益。',
    formula: 'MTD% = 本月净盈亏 / (当前总市值 - 本月净盈亏) × 100%（上月前建仓以上月末收盘价为基准）'
  },
  monthly_cell_hist: {
    title: '历史自然月收益',
    meaning: '基于该月每日资产快照推算的自然月盈亏变动与收益率（受快照记录天数影响）。',
    formula: '月度盈亏 ≈ 月末快照累计盈亏 - 上月末累计盈亏；月收益率 = 月度盈亏 / 月初快照市值 × 100%'
  },
  monthly_ytd_bar: {
    title: '年度累计表现 (YTD)',
    meaning: '今年 1 月 1 日至今的全局投资收益（含今年内已清仓标的实现的盈亏）。',
    formula: 'YTD% = 年内净盈亏 / (当前总市值 - 年内净盈亏) × 100%（去年建仓以去年末收盘价为基准）'
  },
  monthly_trades: {
    title: '月度资金净流向与交易活跃度',
    meaning: '统计每月买入与卖出成交金额（折算 CNY），复盘加仓/减仓节奏是否踩准市场高低点。',
    formula: '买入/卖出额 = ∑(成交价 × 数量 × 汇率)；净流入 = 月度买入总额 - 月度卖出总额'
  },
  currency_exposure: {
    title: '多币种成本投入 vs 当前市值敞口',
    meaning: '按 USD / HKD / CNY / CHF 币种分组对比原始投入成本与当前人民币市值，评估汇率与单一货币敞口风险。',
    formula: '币种收益率% = (该币种当前市值 CNY - 该币种投入成本 CNY) / 该币种投入成本 CNY × 100%'
  },
  concentration_pareto: {
    title: '持仓集中度帕累托曲线 (Pareto)',
    meaning: '遵循二八法则展示头部重仓股对总仓位的累计占比，评估组合分散度与单票黑天鹅风险。',
    formula: '累计占比 = 前 N 大持仓市值之和 / 组合总市值 × 100%（80% 线为高集中度参考线）'
  },
  badge_cr3: {
    title: 'CR3 前三大重仓集中度',
    meaning: '市值占比最高的前 3 只股票合计占总资产的百分比。通常 >60% 属于集中持股风格。',
    formula: 'CR3 = (Top 1 市值 + Top 2 市值 + Top 3 市值) / 组合总市值 × 100%'
  },
  badge_cr5: {
    title: 'CR5 前五大重仓集中度',
    meaning: '市值占比最高的前 5 只股票合计占总资产的百分比，衡量核心持仓统治力。',
    formula: 'CR5 = ∑(Top 1 ~ Top 5 持仓市值) / 组合总市值 × 100%'
  },
  badge_hhi: {
    title: '赫芬达尔-赫希曼指数 (HHI)',
    meaning: '经济学经典集中度指标（0~10000）。<1500 为均衡分散，1500~2500 为适度集中，>2500 为高度集中。',
    formula: 'HHI = ∑((单票市值 / 总市值)² ) × 10000（全仓单票时 HHI = 10000）'
  }
};

// Page state
let state = {
  trendDays: 90,
  trendMarket: 'ALL',
  trendMode: 'value',       // 'value' | 'pnl' | 'ytd'
  marketCompareMetric: 'ytd', // 'ytd' | 'mtd' | 'total' | 'annualized'
  waterfallMetric: 'total', // 'total' | 'ytd' | 'mtd'
  scatterMetric: 'pnlPct',  // 'pnlPct' | 'annualized' | 'ytdPct'
  winrateUnit: 'position',  // 'position' | 'lot'
  summary: null,
  trades: [],
  closedPositions: [],
  snapshotsCache: new Map() // market -> 365d array
};

export async function renderChartsPage(container) {
  state = {
    trendDays: 90,
    trendMarket: 'ALL',
    trendMode: 'value',
    marketCompareMetric: 'ytd',
    waterfallMetric: 'total',
    scatterMetric: 'pnlPct',
    winrateUnit: 'position',
    summary: null,
    trades: [],
    closedPositions: [],
    snapshotsCache: new Map()
  };

  container.innerHTML = `
    <div class="dashboard animate-fade-in-up">
      <div class="page-header" style="margin-bottom: 0;">
        <div>
          <h2 class="page-title" style="display:flex;align-items:center;gap:10px;">
            <i data-lucide="bar-chart-3" style="color:var(--color-accent,#6366f1);"></i>
            深度图表分析与复盘
          </h2>
          <p style="margin:4px 0 0;font-size:0.82rem;color:var(--color-text-muted);">
            多维收益归因 · 交易胜率与盈亏比 · 持仓四象限诊断 · 风险敞口与月度复盘
          </p>
        </div>
      </div>

      <!-- 顶部核心复盘 KPI 卡片 -->
      <section class="dashboard__kpi-row animate-fade-in-up delay-1">
        <div class="kpi-card" data-help-key="kpi_winrate">
          <div class="kpi-card__icon"><i data-lucide="award"></i></div>
          <div class="kpi-card__content">
            <div class="kpi-card__label">整体投资胜率 <span class="sv-help-icon">?</span></div>
            <div class="kpi-card__value" id="analytics-kpi-winrate">--</div>
            <div class="kpi-card__sub" id="analytics-kpi-winrate-sub">加载统计中...</div>
          </div>
        </div>
        <div class="kpi-card" data-help-key="kpi_pf">
          <div class="kpi-card__icon"><i data-lucide="scale"></i></div>
          <div class="kpi-card__content">
            <div class="kpi-card__label">盈亏比 (Profit Factor) <span class="sv-help-icon">?</span></div>
            <div class="kpi-card__value" id="analytics-kpi-pf">--</div>
            <div class="kpi-card__sub" id="analytics-kpi-pf-sub">总盈利 / 总亏损</div>
          </div>
        </div>
        <div class="kpi-card" id="analytics-kpi-dd-card" data-help-key="kpi_mdd">
          <div class="kpi-card__icon"><i data-lucide="shield-alert"></i></div>
          <div class="kpi-card__content">
            <div class="kpi-card__label"><span id="analytics-kpi-dd-label">区间最大回撤</span> <span class="sv-help-icon">?</span></div>
            <div class="kpi-card__value" id="analytics-kpi-dd">--</div>
            <div class="kpi-card__sub" id="analytics-kpi-dd-sub">基于净值快照序列</div>
          </div>
        </div>
        <div class="kpi-card" data-help-key="kpi_holding">
          <div class="kpi-card__icon"><i data-lucide="clock"></i></div>
          <div class="kpi-card__content">
            <div class="kpi-card__label">加权持仓周期 / 年化 <span class="sv-help-icon">?</span></div>
            <div class="kpi-card__value" id="analytics-kpi-days">--</div>
            <div class="kpi-card__sub" id="analytics-kpi-annualized">组合年化 --</div>
          </div>
        </div>
      </section>

      <!-- 模块一：全宽多维资产与收益走势 -->
      <section class="dashboard__section animate-fade-in-up delay-1">
        <div class="chart-container" style="width:100%;">
          <div class="chart-container__header">
            <div class="chart-container__title-group">
              <h3 class="chart-container__title" data-help-key="trend_chart">
                <i data-lucide="trending-up"></i>
                资产与收益净值走势
                <span class="sv-help-icon">?</span>
              </h3>
              <div class="chart-controls" id="trend-mode-controls">
                <button class="chart-controls__btn chart-controls__btn--active" data-trend-mode="value">市值 vs 成本</button>
                <button class="chart-controls__btn" data-trend-mode="pnl">累计盈亏走势</button>
                <button class="chart-controls__btn" data-trend-mode="ytd">YTD 年内收益</button>
              </div>
            </div>
            <div class="chart-container__toolbar">
              <div class="chart-controls" id="trend-market-controls">
                <button class="chart-controls__btn chart-controls__btn--active" data-trend-market="ALL">全部</button>
                <button class="chart-controls__btn" data-trend-market="US">🇺🇸 美股</button>
                <button class="chart-controls__btn" data-trend-market="HK">🇭🇰 港股</button>
                <button class="chart-controls__btn" data-trend-market="A_SHARE">🇨🇳 A股</button>
                <button class="chart-controls__btn" data-trend-market="SWISS">🇨🇭 瑞士</button>
              </div>
              <div class="chart-controls" id="trend-days-controls">
                <button class="chart-controls__btn" data-trend-days="30">近30天</button>
                <button class="chart-controls__btn chart-controls__btn--active" data-trend-days="90">近90天</button>
                <button class="chart-controls__btn" data-trend-days="180">近半年</button>
                <button class="chart-controls__btn" data-trend-days="365">近一年</button>
              </div>
            </div>
          </div>
          <div class="chart-trend-summary" id="trend-summary-bar">
            <span class="chart-trend-summary__item">
              <span class="chart-trend-summary__label">当前范围：</span>
              <span class="chart-trend-summary__val" id="trend-stat-range">全部市场 · 近90天</span>
            </span>
            <span class="chart-trend-summary__item" data-help-key="trend_peak">
              <span class="chart-trend-summary__label">区间峰值 <span class="sv-help-icon">?</span>：</span>
              <span class="chart-trend-summary__val" id="trend-stat-peak">--</span>
            </span>
            <span class="chart-trend-summary__item" data-help-key="trend_mdd">
              <span class="chart-trend-summary__label">最大回撤 <span class="sv-help-icon">?</span>：</span>
              <span class="chart-trend-summary__val" id="trend-stat-mdd">--</span>
            </span>
            <span class="chart-trend-summary__item" data-help-key="trend_change">
              <span class="chart-trend-summary__label">区间盈亏变动 <span class="sv-help-icon">?</span>：</span>
              <span class="chart-trend-summary__val" id="trend-stat-change">--</span>
            </span>
          </div>
          <div class="chart-container__body" id="chart-asset-trend" style="height:370px"></div>
        </div>
      </section>

      <!-- 模块二：各市场多维对比 & 盈亏贡献瀑布图 -->
      <section class="dashboard__section animate-fade-in-up delay-2">
        <div class="dashboard__charts-row">
          <div class="chart-container">
            <div class="chart-container__header">
              <h3 class="chart-container__title" data-help-key="market_compare">
                <i data-lucide="globe-2"></i>
                各市场收益表现对比
                <span class="sv-help-icon">?</span>
              </h3>
              <div class="chart-controls" id="market-compare-controls">
                <button class="chart-controls__btn chart-controls__btn--active" data-mkt-metric="ytd">YTD 年内</button>
                <button class="chart-controls__btn" data-mkt-metric="mtd">本月 MTD</button>
                <button class="chart-controls__btn" data-mkt-metric="total">累计盈亏</button>
                <button class="chart-controls__btn" data-mkt-metric="annualized">年化%</button>
              </div>
            </div>
            <div class="chart-container__body" id="chart-ytd-market" style="height:320px"></div>
          </div>

          <div class="chart-container">
            <div class="chart-container__header">
              <div class="chart-container__title-group">
                <h3 class="chart-container__title" data-help-key="waterfall">
                  <i data-lucide="git-pull-request"></i>
                  盈亏归因瀑布图 (Waterfall)
                  <span class="sv-help-icon">?</span>
                </h3>
              </div>
              <div class="chart-controls" id="waterfall-controls">
                <button class="chart-controls__btn chart-controls__btn--active" data-wf-metric="total">累计总盈亏</button>
                <button class="chart-controls__btn" data-wf-metric="ytd">YTD 归因</button>
                <button class="chart-controls__btn" data-wf-metric="mtd">本月 MTD</button>
              </div>
            </div>
            <div class="chart-container__body" id="chart-pnl-waterfall" style="height:320px"></div>
          </div>
        </div>
      </section>

      <!-- 模块三：持仓四象限气泡图 & 交易胜率结构复盘 -->
      <section class="dashboard__section animate-fade-in-up delay-3">
        <div class="dashboard__charts-row">
          <div class="chart-container">
            <div class="chart-container__header">
              <div class="chart-container__title-group">
                <h3 class="chart-container__title" data-help-key="quadrant">
                  <i data-lucide="compass"></i>
                  持仓周期 × 收益率 四象限诊断
                  <span class="sv-help-icon">?</span>
                </h3>
                <span class="chart-container__hint">气泡大小=市值 · 点击气泡看逐笔明细</span>
              </div>
              <div class="chart-controls" id="scatter-controls">
                <button class="chart-controls__btn chart-controls__btn--active" data-scatter-metric="pnlPct">总收益率%</button>
                <button class="chart-controls__btn" data-scatter-metric="annualized">年化%</button>
                <button class="chart-controls__btn" data-scatter-metric="ytdPct">YTD%</button>
              </div>
            </div>
            <div class="chart-container__body" id="chart-pnl-scatter" style="height:330px"></div>
          </div>

          <div class="chart-container">
            <div class="chart-container__header">
              <h3 class="chart-container__title" data-help-key="winrate_panel">
                <i data-lucide="pie-chart"></i>
                胜率分布与盈亏结构复盘
                <span class="sv-help-icon">?</span>
              </h3>
              <div class="chart-controls" id="winrate-controls">
                <button class="chart-controls__btn chart-controls__btn--active" data-winrate-unit="position">按持仓标的</button>
                <button class="chart-controls__btn" data-winrate-unit="lot">按逐笔批次</button>
              </div>
            </div>
            <div class="chart-winrate-layout">
              <div id="chart-winrate-pie" style="width:100%;height:300px;"></div>
              <div class="chart-winrate-stats" id="winrate-stats-panel">
                <div class="chart-stat-row">
                  <span class="chart-stat-row__label">数据加载中...</span>
                  <span class="chart-stat-row__value">--</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 模块四：月度收益热力矩阵 & 月度交易资金流向 -->
      <section class="dashboard__section animate-fade-in-up delay-4">
        <div class="dashboard__charts-row">
          <div class="chart-container">
            <div class="chart-container__header">
              <div class="chart-container__title-group">
                <h3 class="chart-container__title" data-help-key="monthly_matrix">
                  <i data-lucide="calendar-days"></i>
                  月度收益日历矩阵 (${new Date().getFullYear()}年)
                  <span class="sv-help-icon">?</span>
                </h3>
                <span class="chart-container__hint" id="monthly-matrix-hint">融合快照历史与当月实时 MTD</span>
              </div>
            </div>
            <div class="chart-container__body" id="chart-monthly-matrix" style="min-height:310px;display:flex;flex-direction:column;justify-content:center;"></div>
          </div>

          <div class="chart-container">
            <div class="chart-container__header">
              <div class="chart-container__title-group">
                <h3 class="chart-container__title" data-help-key="monthly_trades">
                  <i data-lucide="arrow-left-right"></i>
                  月度资金净流向与交易活跃度
                  <span class="sv-help-icon">?</span>
                </h3>
                <span class="chart-container__hint">买入 vs 卖出 (CNY) 及净流入曲线</span>
              </div>
            </div>
            <div class="chart-container__body" id="chart-monthly-trades" style="height:310px"></div>
          </div>
        </div>
      </section>

      <!-- 模块五：多币种成本vs市值敞口 & 持仓集中度帕累托图 -->
      <section class="dashboard__section animate-fade-in-up delay-5">
        <div class="dashboard__charts-row">
          <div class="chart-container">
            <div class="chart-container__header">
              <div class="chart-container__title-group">
                <h3 class="chart-container__title" data-help-key="currency_exposure">
                  <i data-lucide="coins"></i>
                  多币种成本投入 vs 当前市值敞口
                  <span class="sv-help-icon">?</span>
                </h3>
                <span class="chart-container__hint">折算人民币 (CNY) 对比</span>
              </div>
            </div>
            <div class="chart-container__body" id="chart-currency-exposure" style="height:320px"></div>
          </div>

          <div class="chart-container">
            <div class="chart-container__header">
              <div class="chart-container__title-group">
                <h3 class="chart-container__title" data-help-key="concentration_pareto">
                  <i data-lucide="layers"></i>
                  持仓集中度帕累托曲线 (Pareto)
                  <span class="sv-help-icon">?</span>
                </h3>
              </div>
              <div class="concentration-badges" id="concentration-badges">
                <span class="concentration-badge" data-help-key="badge_cr3">CR3: --</span>
                <span class="concentration-badge" data-help-key="badge_cr5">CR5: --</span>
              </div>
            </div>
            <div class="chart-container__body" id="chart-concentration-pareto" style="height:320px"></div>
          </div>
        </div>
      </section>
    </div>
  `;

  initTheme();
  const cleanupTooltips = setupMetricTooltips(container);
  bindControls(container);
  await loadAllAnalyticsData();

  // Auto-refresh support
  const refreshHandler = () => {
    state.snapshotsCache.clear();
    loadAllAnalyticsData();
  };
  window.addEventListener('stockvault:refresh', refreshHandler);

  const observer = new MutationObserver(() => {
    if (!document.getElementById('chart-asset-trend')) {
      window.removeEventListener('stockvault:refresh', refreshHandler);
      cleanupTooltips();
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });
}

/**
 * Bind interactive toolbar buttons
 */
function bindControls(container) {
  // 1. Trend Mode
  container.querySelectorAll('[data-trend-mode]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      container.querySelectorAll('[data-trend-mode]').forEach(b => b.classList.remove('chart-controls__btn--active'));
      e.currentTarget.classList.add('chart-controls__btn--active');
      state.trendMode = e.currentTarget.dataset.trendMode;
      refreshAssetTrendChart();
    });
  });

  // 2. Trend Market
  container.querySelectorAll('[data-trend-market]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      container.querySelectorAll('[data-trend-market]').forEach(b => b.classList.remove('chart-controls__btn--active'));
      e.currentTarget.classList.add('chart-controls__btn--active');
      state.trendMarket = e.currentTarget.dataset.trendMarket;
      await refreshAssetTrendChart();
    });
  });

  // 3. Trend Days
  container.querySelectorAll('[data-trend-days]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      container.querySelectorAll('[data-trend-days]').forEach(b => b.classList.remove('chart-controls__btn--active'));
      e.currentTarget.classList.add('chart-controls__btn--active');
      state.trendDays = parseInt(e.currentTarget.dataset.trendDays, 10);
      await refreshAssetTrendChart();
    });
  });

  // 4. Market comparison metric
  container.querySelectorAll('[data-mkt-metric]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      container.querySelectorAll('[data-mkt-metric]').forEach(b => b.classList.remove('chart-controls__btn--active'));
      e.currentTarget.classList.add('chart-controls__btn--active');
      state.marketCompareMetric = e.currentTarget.dataset.mktMetric;
      renderMarketComparisonChart();
    });
  });

  // 5. Waterfall metric
  container.querySelectorAll('[data-wf-metric]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      container.querySelectorAll('[data-wf-metric]').forEach(b => b.classList.remove('chart-controls__btn--active'));
      e.currentTarget.classList.add('chart-controls__btn--active');
      state.waterfallMetric = e.currentTarget.dataset.wfMetric;
      renderWaterfallChart();
    });
  });

  // 6. Scatter metric
  container.querySelectorAll('[data-scatter-metric]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      container.querySelectorAll('[data-scatter-metric]').forEach(b => b.classList.remove('chart-controls__btn--active'));
      e.currentTarget.classList.add('chart-controls__btn--active');
      state.scatterMetric = e.currentTarget.dataset.scatterMetric;
      renderQuadrantScatterChart();
    });
  });

  // 7. Winrate unit
  container.querySelectorAll('[data-winrate-unit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      container.querySelectorAll('[data-winrate-unit]').forEach(b => b.classList.remove('chart-controls__btn--active'));
      e.currentTarget.classList.add('chart-controls__btn--active');
      state.winrateUnit = e.currentTarget.dataset.winrateUnit;
      renderWinrateAndStructure();
    });
  });
}

/**
 * Load all data sources in parallel and render all modules
 */
async function loadAllAnalyticsData() {
  const [summary, trades, closedPositions, snapshotsAll] = await Promise.all([
    get('/api/summary', {}, { silent: true }).catch(() => null),
    get('/api/trades', {}, { silent: true }).catch(() => []),
    get('/api/positions', { status: 'CLOSED' }, { silent: true }).catch(() => []),
    get('/api/snapshots', { days: 365, market: 'ALL' }, { silent: true }).catch(() => [])
  ]);

  state.summary = summary || { positions: [], markets: {}, exchangeRates: {} };
  state.trades = Array.isArray(trades) ? trades : [];
  state.closedPositions = Array.isArray(closedPositions) ? closedPositions : [];
  if (Array.isArray(snapshotsAll)) {
    state.snapshotsCache.set('ALL', snapshotsAll);
  }

  // Render everything
  await refreshAssetTrendChart();
  updateTopKpiCards();
  renderMarketComparisonChart();
  renderWaterfallChart();
  renderQuadrantScatterChart();
  renderWinrateAndStructure();
  renderMonthlyMatrix();
  renderMonthlyTradesChart();
  renderCurrencyExposureChart();
  renderConcentrationParetoChart();
}

/**
 * Helper to get 1 foreign currency = X CNY rate
 */
function getRateToCNY(currency, rates = {}) {
  if (!currency || currency === 'CNY') return 1;
  const r = Number(rates[currency]);
  if (!r || isNaN(r)) {
    const fallback = { USD: 7.2, HKD: 0.923, CHF: 8.1 };
    return fallback[currency] || 1;
  }
  if (currency === 'HKD') return r > 1 ? 1 / r : r;
  return r < 1 ? 1 / r : r;
}

/**
 * Compute realized PnL in CNY for closed positions & sell trades
 */
function computeWinLossStats(unit = 'position') {
  const openPositions = (state.summary?.positions || []).filter(p => p.status === 'OPEN' || !p.status);
  const rates = state.summary?.exchangeRates || {};

  let unrealizedProfitCNY = 0;
  let unrealizedLossCNY = 0;
  for (const p of openPositions) {
    const pnl = Number(p.pnlCNY) || 0;
    if (pnl >= 0) unrealizedProfitCNY += pnl;
    else unrealizedLossCNY += Math.abs(pnl);
  }

  // Closed positions realized PnL in CNY
  let realizedProfitCNY = 0;
  let realizedLossCNY = 0;
  const closedItems = [];
  for (const cp of state.closedPositions) {
    if (cp.close_price == null) continue;
    const rate = getRateToCNY(cp.currency, rates);
    const costCNY = (Number(cp.open_price) * Number(cp.quantity) + Number(cp.commission || 0)) * rate;
    const proceedsCNY = (Number(cp.close_price) * Number(cp.quantity) - Number(cp.close_commission || 0)) * rate;
    const pnlCNY = proceedsCNY - costCNY;
    if (pnlCNY >= 0) realizedProfitCNY += pnlCNY;
    else realizedLossCNY += Math.abs(pnlCNY);
    closedItems.push({
      name: `${cp.name} (已平仓)`,
      symbol: cp.symbol,
      pnlCNY,
      pnlPercent: costCNY > 0 ? (pnlCNY / costCNY) * 100 : 0,
      isClosed: true
    });
  }

  const items = [];
  if (unit === 'lot') {
    for (const p of openPositions) {
      const rate = p.rateToCNY || getRateToCNY(p.currency, rates);
      if (Array.isArray(p.activeLots) && p.activeLots.length > 0) {
        for (const lot of p.activeLots) {
          const pnlCNY = (Number(lot.pnlNative) || 0) * rate;
          items.push({
            name: `${p.name} (${lot.trade_date || '批次'})`,
            symbol: p.symbol,
            pnlCNY,
            pnlPercent: Number(lot.pnlPercent) || 0,
            isClosed: false
          });
        }
      } else {
        items.push({
          name: p.name,
          symbol: p.symbol,
          pnlCNY: Number(p.pnlCNY) || 0,
          pnlPercent: Number(p.pnlPercent) || 0,
          isClosed: false
        });
      }
    }
    items.push(...closedItems);
  } else {
    for (const p of openPositions) {
      items.push({
        name: p.name,
        symbol: p.symbol,
        pnlCNY: Number(p.pnlCNY) || 0,
        pnlPercent: Number(p.pnlPercent) || 0,
        isClosed: false
      });
    }
    items.push(...closedItems);
  }

  const winners = items.filter(i => i.pnlCNY > 0);
  const losers = items.filter(i => i.pnlCNY < 0);
  const flat = items.filter(i => i.pnlCNY === 0);

  const totalCount = items.length;
  const winRate = totalCount > 0 ? (winners.length / totalCount) * 100 : 0;

  const grossProfit = winners.reduce((s, i) => s + i.pnlCNY, 0);
  const grossLoss = losers.reduce((s, i) => s + Math.abs(i.pnlCNY), 0);
  const avgWin = winners.length > 0 ? grossProfit / winners.length : 0;
  const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0;

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0);

  const sortedByPnl = [...items].sort((a, b) => b.pnlCNY - a.pnlCNY);
  const bestItem = sortedByPnl[0] || null;
  const worstItem = sortedByPnl[sortedByPnl.length - 1] || null;

  return {
    items,
    winners,
    losers,
    flat,
    totalCount,
    winRate,
    grossProfit,
    grossLoss,
    avgWin,
    avgLoss,
    profitFactor,
    payoffRatio,
    bestItem,
    worstItem,
    unrealizedProfitCNY,
    unrealizedLossCNY,
    realizedProfitCNY,
    realizedLossCNY
  };
}

/**
 * Update top 4 KPI cards
 */
function updateTopKpiCards() {
  const stats = computeWinLossStats('position');
  const summary = state.summary || {};

  // 1. Win Rate
  const winrateEl = document.getElementById('analytics-kpi-winrate');
  const winrateSubEl = document.getElementById('analytics-kpi-winrate-sub');
  if (winrateEl) {
    winrateEl.textContent = `${stats.winRate.toFixed(1)}%`;
    winrateEl.className = `kpi-card__value kpi-card__value--${stats.winRate >= 50 ? 'profit' : 'loss'}`;
  }
  if (winrateSubEl) {
    winrateSubEl.textContent = `${stats.winners.length} 盈 / ${stats.losers.length} 亏 (共 ${stats.totalCount} 标的)`;
  }

  // 2. Profit Factor
  const pfEl = document.getElementById('analytics-kpi-pf');
  const pfSubEl = document.getElementById('analytics-kpi-pf-sub');
  if (pfEl) {
    const pfText = stats.profitFactor === Infinity ? '∞ (无亏损)' : stats.profitFactor.toFixed(2);
    pfEl.textContent = pfText;
    pfEl.className = `kpi-card__value kpi-card__value--${stats.profitFactor >= 1 ? 'profit' : 'loss'}`;
  }
  if (pfSubEl) {
    const ratioText = stats.payoffRatio === Infinity ? '∞' : stats.payoffRatio.toFixed(2);
    pfSubEl.textContent = `单笔均盈亏比 ${ratioText}x`;
  }

  // 3. Max Drawdown (or Concentration if <2 snapshots)
  const allSnapshots = state.snapshotsCache.get('ALL') || [];
  const ddCardEl = document.getElementById('analytics-kpi-dd-card');
  const ddLabelEl = document.getElementById('analytics-kpi-dd-label');
  const ddEl = document.getElementById('analytics-kpi-dd');
  const ddSubEl = document.getElementById('analytics-kpi-dd-sub');

  if (allSnapshots.length >= 2) {
    const metrics = computeTrendMetrics(allSnapshots);
    if (ddCardEl) ddCardEl.setAttribute('data-help-key', 'kpi_mdd');
    if (ddLabelEl) ddLabelEl.textContent = '近一年最大回撤';
    if (ddEl) {
      ddEl.textContent = metrics.maxDrawdownPct > 0 ? `-${metrics.maxDrawdownPct.toFixed(2)}%` : '0.00%';
      ddEl.className = `kpi-card__value kpi-card__value--${metrics.maxDrawdownPct > 10 ? 'loss' : 'neutral'}`;
    }
    if (ddSubEl) {
      ddSubEl.textContent = metrics.maxDrawdownVal > 0
        ? `回撤额 ${formatCurrency(metrics.maxDrawdownVal, 'CNY', false, 'wan')}`
        : '净值持续创新高';
    }
  } else {
    // Fallback: show Top 3 concentration (CR3)
    const openPositions = (summary.positions || []).filter(p => p.status === 'OPEN' || !p.status);
    const sortedWeights = [...openPositions].sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const cr3 = sortedWeights.slice(0, 3).reduce((s, p) => s + (p.weight || 0), 0);
    if (ddCardEl) ddCardEl.setAttribute('data-help-key', 'kpi_cr3');
    if (ddLabelEl) ddLabelEl.textContent = '前三大重仓集中度 (CR3)';
    if (ddEl) {
      ddEl.textContent = `${cr3.toFixed(1)}%`;
      ddEl.className = 'kpi-card__value kpi-card__value--neutral';
    }
    if (ddSubEl) {
      ddSubEl.textContent = sortedWeights[0] ? `第一重仓: ${sortedWeights[0].name} (${(sortedWeights[0].weight || 0).toFixed(1)}%)` : '暂无持仓';
    }
  }

  // 4. Holding Period & Annualized Return
  const daysEl = document.getElementById('analytics-kpi-days');
  const annEl = document.getElementById('analytics-kpi-annualized');
  const avgDays = summary.totalAvgHoldingDays || 0;
  const annPct = summary.totalAnnualizedReturn || 0;
  if (daysEl) {
    daysEl.textContent = `${avgDays} 天`;
  }
  if (annEl) {
    annEl.textContent = `组合加权年化 ${formatPercent(annPct)}`;
    annEl.className = `kpi-card__sub kpi-card__sub--${getPnLClass(annPct)}`;
  }
}

/**
 * Module 1: Load and render interactive Asset & Return Trend chart
 */
async function refreshAssetTrendChart() {
  const container = document.getElementById('chart-asset-trend');
  if (!container) return;

  const { trendDays, trendMarket, trendMode } = state;

  try {
    let fullSnapshots = state.snapshotsCache.get(trendMarket);
    if (!fullSnapshots) {
      fullSnapshots = await get('/api/snapshots', { days: 365, market: trendMarket }, { silent: true }) || [];
      state.snapshotsCache.set(trendMarket, fullSnapshots);
    }

    // Filter by days from cutoff date
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - trendDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const filtered = fullSnapshots.filter(s => s.date >= cutoffStr);

    renderAssetTrend(container, filtered, { mode: trendMode });

    // Update summary bar above trend chart
    const metrics = computeTrendMetrics(filtered);
    const rangeEl = document.getElementById('trend-stat-range');
    const peakEl = document.getElementById('trend-stat-peak');
    const mddEl = document.getElementById('trend-stat-mdd');
    const changeEl = document.getElementById('trend-stat-change');

    if (rangeEl) rangeEl.textContent = `${MARKET_LABELS[trendMarket] || trendMarket} · 近${trendDays}天 (${filtered.length}个快照点)`;
    if (peakEl) peakEl.textContent = filtered.length ? `${formatCurrency(metrics.highVal)} (${metrics.highDate || '--'})` : '--';
    if (mddEl) {
      mddEl.textContent = filtered.length >= 2
        ? `-${metrics.maxDrawdownPct.toFixed(2)}% (${formatCurrency(metrics.maxDrawdownVal)})`
        : '--';
    }
    if (changeEl) {
      if (filtered.length >= 2) {
        changeEl.textContent = `${formatCurrency(metrics.periodChangeVal, 'CNY', true)} (${formatPercent(metrics.periodChangePct)})`;
        changeEl.className = `chart-trend-summary__val kpi-card__sub--${getPnLClass(metrics.periodChangeVal)}`;
      } else {
        changeEl.textContent = '--';
        changeEl.className = 'chart-trend-summary__val';
      }
    }
  } catch (err) {
    console.error('[Charts] Asset trend failed:', err);
  }
}

/**
 * Module 2A: Multi-metric Market Comparison Chart (YTD / MTD / Total / Annualized)
 */
function renderMarketComparisonChart() {
  const container = document.getElementById('chart-ytd-market');
  if (!container) return;

  const markets = state.summary?.markets || {};
  const metric = state.marketCompareMetric;

  const entries = Object.entries(markets)
    .filter(([_, d]) => (d.positionCount || 0) > 0 || (d.ytdPnlCNY || 0) !== 0);

  if (entries.length === 0) {
    renderEmptyChart(container, '📊', '暂无各市场收益数据');
    return;
  }

  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');
  const isCN = getColorScheme() === 'cn';
  const profitColor = isCN ? '#ef4444' : '#10b981';
  const lossColor = isCN ? '#10b981' : '#ef4444';

  const getValAndPct = (d) => {
    if (metric === 'ytd') return { val: d.ytdPnlCNY || 0, pct: d.ytdPercent || 0, isPctMain: false, label: 'YTD 收益' };
    if (metric === 'mtd') return { val: d.mtdPnlCNY || 0, pct: d.mtdPercent || d.monthlyReturn || 0, isPctMain: false, label: '本月 MTD 收益' };
    if (metric === 'total') return { val: d.totalPnlCNY ?? d.totalPnL ?? 0, pct: d.pnlPercent || 0, isPctMain: false, label: '累计总盈亏' };
    return { val: d.annualizedReturn || 0, pct: d.pnlPercent || 0, isPctMain: true, label: '加权年化收益率' };
  };

  const mapped = entries.map(([id, d]) => ({
    id,
    name: MARKET_LABELS[id] || id,
    ...getValAndPct(d),
    raw: d
  })).sort((a, b) => a.val - b.val);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const item = mapped[idx];
        const d = item.raw;
        return `
          <div style="font-weight:600;margin-bottom:6px;">${item.name}（${d.positionCount || 0} 支）</div>
          <div>当前市值：<b>${formatCurrency(d.totalValueCNY || d.totalValue || 0)}</b></div>
          <div>累计盈亏：<b>${formatCurrency(d.totalPnlCNY ?? d.totalPnL ?? 0, 'CNY', true)} (${formatPercent(d.pnlPercent || 0)})</b></div>
          <div>YTD 收益：<b>${formatCurrency(d.ytdPnlCNY || 0, 'CNY', true)} (${formatPercent(d.ytdPercent || 0)})</b></div>
          <div>本月 MTD：<b>${formatCurrency(d.mtdPnlCNY || 0, 'CNY', true)} (${formatPercent(d.mtdPercent || 0)})</b></div>
          <div>加权年化：<b>${formatPercent(d.annualizedReturn || 0)}</b>（均持仓 ${d.avgHoldingDays || 1} 天）</div>
        `;
      }
    },
    grid: { top: 16, bottom: 20, left: 10, right: 110, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v) => {
          if (metric === 'annualized') return `${v}%`;
          return Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + '万' : v;
        }
      }
    },
    yAxis: {
      type: 'category',
      data: mapped.map(m => m.name),
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      barMaxWidth: 32,
      data: mapped.map(m => ({
        value: m.val,
        itemStyle: {
          color: m.val >= 0 ? profitColor : lossColor,
          borderRadius: m.val >= 0 ? [0, 6, 6, 0] : [6, 0, 0, 6]
        }
      })),
      label: {
        show: true,
        position: 'right',
        formatter: (p) => {
          const item = mapped[p.dataIndex];
          if (item.isPctMain) return `${formatPercent(item.val)}`;
          return `${formatCurrency(item.val, 'CNY', true, 'wan')} (${formatPercent(item.pct)})`;
        },
        color: '#cbd5e1',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace'
      }
    }]
  };

  chart.setOption(option);
  setupResize(chart);
}

/**
 * Module 2B: PnL Attribution Waterfall Chart
 */
function renderWaterfallChart() {
  const container = document.getElementById('chart-pnl-waterfall');
  if (!container) return;

  const positions = (state.summary?.positions || []).filter(p => p.status === 'OPEN' || !p.status);
  if (positions.length === 0) {
    renderEmptyChart(container, '🌊', '暂无持仓盈亏归因数据');
    return;
  }

  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');
  const isCN = getColorScheme() === 'cn';
  const profitColor = isCN ? '#ef4444' : '#10b981';
  const lossColor = isCN ? '#10b981' : '#ef4444';

  const metric = state.waterfallMetric;
  const getVal = (p) => {
    if (metric === 'ytd') return Number(p.ytdPnLCNY) || 0;
    if (metric === 'mtd') return Number(p.mtdPnLCNY) || 0;
    return Number(p.pnlCNY) || 0;
  };

  // Sort by contribution descending: top winners first, then losers
  const items = positions.map(p => ({
    name: p.name,
    symbol: p.symbol,
    val: toFixed2(getVal(p))
  })).filter(i => i.val !== 0);

  if (items.length === 0) {
    renderEmptyChart(container, '🌊', '所选维度下各持仓盈亏均为 0');
    return;
  }

  // Keep up to top 4 winners and top 4 losers, group the rest as "其他持仓"
  const posItems = items.filter(i => i.val > 0).sort((a, b) => b.val - a.val);
  const negItems = items.filter(i => i.val < 0).sort((a, b) => a.val - b.val); // most negative first

  const topPos = posItems.slice(0, 4);
  const topNeg = negItems.slice(0, 4).reverse(); // least negative to most negative for smooth waterfall step down
  const restVal = toFixed2(
    posItems.slice(4).reduce((s, i) => s + i.val, 0) +
    negItems.slice(4).reduce((s, i) => s + i.val, 0)
  );

  const steps = [...topPos];
  if (Math.abs(restVal) > 0.01) {
    steps.push({ name: '其他汇总', symbol: 'OTHER', val: restVal });
  }
  steps.push(...topNeg);

  const totalNet = toFixed2(items.reduce((s, i) => s + i.val, 0));

  const categories = [...steps.map(s => s.name), '净收益合计'];
  const baseData = [];
  const barData = [];

  let running = 0;
  for (const step of steps) {
    const next = toFixed2(running + step.val);
    const low = Math.min(running, next);
    const span = Math.abs(step.val);
    baseData.push(low);
    barData.push({
      value: span,
      rawVal: step.val,
      isTotal: false,
      itemStyle: {
        color: step.val >= 0 ? profitColor : lossColor,
        borderRadius: [3, 3, 3, 3]
      }
    });
    running = next;
  }

  // Final total column anchored at 0
  baseData.push(Math.min(0, totalNet));
  barData.push({
    value: Math.abs(totalNet),
    rawVal: totalNet,
    isTotal: true,
    itemStyle: {
      color: '#6366f1',
      borderRadius: [4, 4, 0, 0]
    }
  });

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const barParam = params.find(p => p.seriesName === '变动');
        if (!barParam) return '';
        const d = barParam.data;
        const label = d.isTotal ? '组合净收益合计' : '单项盈亏贡献';
        return `<b>${barParam.name}</b><br/>${label}：<b>${formatCurrency(d.rawVal, 'CNY', true)}</b>`;
      }
    },
    grid: { top: 26, bottom: 24, left: 12, right: 16, containLabel: true },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: {
        color: '#94a3b8',
        fontSize: 10,
        interval: 0,
        rotate: categories.length > 6 ? 20 : 0,
        formatter: (v) => v.length > 6 ? v.slice(0, 6) + '…' : v
      }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v) => Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + '万' : v
      }
    },
    series: [
      {
        name: '辅助基线',
        type: 'bar',
        stack: 'waterfall',
        silent: true,
        itemStyle: { borderColor: 'transparent', color: 'transparent' },
        emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
        data: baseData
      },
      {
        name: '变动',
        type: 'bar',
        stack: 'waterfall',
        barMaxWidth: 34,
        data: barData,
        label: {
          show: true,
          position: 'top',
          formatter: (p) => formatCurrency(p.data.rawVal, 'CNY', true, 'wan'),
          color: '#cbd5e1',
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace'
        }
      }
    ]
  };

  chart.setOption(option);
  setupResize(chart);
}

/**
 * Module 3A: Holding Period x Return Rate x Market Value 4-Quadrant Bubble Chart
 */
function renderQuadrantScatterChart() {
  const container = document.getElementById('chart-pnl-scatter');
  if (!container) return;

  const positions = (state.summary?.positions || []).filter(p => p.status === 'OPEN' || !p.status);
  if (positions.length === 0) {
    renderEmptyChart(container, '🧭', '暂无持仓数据');
    return;
  }

  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');
  const isCN = getColorScheme() === 'cn';
  const profitColor = isCN ? '#ef4444' : '#10b981';
  const lossColor = isCN ? '#10b981' : '#ef4444';

  const metric = state.scatterMetric;
  const getMetricValue = (p) => {
    if (metric === 'annualized') return Number(p.annualizedReturn) || 0;
    if (metric === 'ytdPct') return Number(p.ytdPercent) || 0;
    return Number(p.pnlPercent) || 0;
  };
  const metricLabel = metric === 'annualized' ? '年化收益率(%)' : (metric === 'ytdPct' ? 'YTD收益率(%)' : '总收益率(%)');

  const avgDays = state.summary?.totalAvgHoldingDays ||
    Math.round(positions.reduce((s, p) => s + (p.avgHoldingDays || p.holdingDays || 1), 0) / positions.length);

  const maxMv = Math.max(...positions.map(p => p.marketValueCNY || 1), 1);

  const scatterData = positions.map(p => {
    const days = p.avgHoldingDays || p.holdingDays || 1;
    const yVal = getMetricValue(p);
    const mv = p.marketValueCNY || 0;
    const pnl = p.pnlCNY || 0;
    return {
      value: [days, yVal, mv, p.name, p.symbol, pnl],
      rawPos: p,
      itemStyle: {
        color: yVal >= 0 ? profitColor : lossColor,
        opacity: 0.82,
        shadowBlur: 10,
        shadowColor: 'rgba(0,0,0,0.25)'
      }
    };
  });

  const option = {
    tooltip: {
      formatter: (p) => {
        const d = p.data.value;
        const pos = p.data.rawPos;
        const quadrant = d[0] >= avgDays
          ? (d[1] >= 0 ? '🌟 长线稳赢' : '⏳ 长线被套')
          : (d[1] >= 0 ? '⚡ 短线高效' : '🌱 建仓观察');
        return `
          <div style="font-weight:600;margin-bottom:4px;">${d[3]} (${d[4]}) · <span style="color:#a5b4fc;">${quadrant}</span></div>
          <div>持仓周期：<b>${d[0]} 天</b></div>
          <div>${metricLabel}：<b>${formatPercent(d[1])}</b></div>
          <div>当前市值：<b>${formatCurrency(d[2])}</b> (占比 ${(pos.weight || 0).toFixed(1)}%)</div>
          <div>累计盈亏：<b>${formatCurrency(d[5], 'CNY', true)}</b></div>
          <div style="margin-top:4px;font-size:0.72rem;color:#94a3b8;">💡 点击气泡查看未平仓逐笔明细</div>
        `;
      }
    },
    grid: { top: 28, bottom: 42, left: 16, right: 28, containLabel: true },
    xAxis: {
      type: 'value',
      name: '持仓天数 (天)',
      nameLocation: 'center',
      nameGap: 26,
      nameTextStyle: { color: '#94a3b8', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.05)' } }
    },
    yAxis: {
      type: 'value',
      name: metricLabel,
      nameLocation: 'center',
      nameGap: 44,
      nameTextStyle: { color: '#94a3b8', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.06)' } },
      axisLabel: { formatter: (v) => `${v}%` }
    },
    series: [{
      type: 'scatter',
      symbolSize: (val) => {
        const ratio = Math.sqrt(Math.max(val[2], 0) / maxMv);
        return Math.max(12, Math.min(44, Math.round(10 + ratio * 34)));
      },
      data: scatterData,
      label: {
        show: true,
        position: 'top',
        formatter: (p) => p.data.value[3],
        color: '#cbd5e1',
        fontSize: 10
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: 'rgba(148, 163, 184, 0.35)', type: 'dashed', width: 1.2 },
        data: [
          { yAxis: 0, label: { formatter: '0% 盈亏线', color: '#94a3b8', fontSize: 10, position: 'insideEndTop' } },
          { xAxis: avgDays, label: { formatter: `均期 ${avgDays}天`, color: '#94a3b8', fontSize: 10, position: 'insideEndTop' } }
        ]
      }
    }]
  };

  chart.setOption(option);
  setupResize(chart);

  // Click bubble to inspect lots
  chart.on('click', (params) => {
    const pos = params?.data?.rawPos;
    if (pos && Array.isArray(pos.activeLots) && pos.activeLots.length > 0) {
      showActiveLotsModal({ id: pos.id, name: pos.name, symbol: pos.symbol }, pos.currency || 'CNY', pos.activeLots);
    }
  });
}

/**
 * Module 3B: Win Rate & Realized/Unrealized Structure Nested Donut + Stats Panel
 */
function renderWinrateAndStructure() {
  const pieContainer = document.getElementById('chart-winrate-pie');
  const statsPanel = document.getElementById('winrate-stats-panel');
  if (!pieContainer || !statsPanel) return;

  const stats = computeWinLossStats(state.winrateUnit);
  const isCN = getColorScheme() === 'cn';
  const profitColor = isCN ? '#ef4444' : '#10b981';
  const lossColor = isCN ? '#10b981' : '#ef4444';

  // Render stats panel
  const bestStr = stats.bestItem
    ? `${stats.bestItem.name} (${formatCurrency(stats.bestItem.pnlCNY, 'CNY', true, 'wan')})`
    : '--';
  const worstStr = stats.worstItem && stats.worstItem.pnlCNY < 0
    ? `${stats.worstItem.name} (${formatCurrency(stats.worstItem.pnlCNY, 'CNY', true, 'wan')})`
    : '无亏损项';

  const netRealized = stats.realizedProfitCNY - stats.realizedLossCNY;
  const netUnrealized = stats.unrealizedProfitCNY - stats.unrealizedLossCNY;

  statsPanel.innerHTML = `
    <div class="chart-stat-row" data-help-key="stat_winrate">
      <span class="chart-stat-row__label">统计胜率 (${state.winrateUnit === 'lot' ? '按批次' : '按标的'})</span>
      <span class="chart-stat-row__value kpi-card__sub--${stats.winRate >= 50 ? 'profit' : 'loss'}">
        ${stats.winRate.toFixed(1)}% (${stats.winners.length}胜 / ${stats.losers.length}负)
      </span>
    </div>
    <div class="chart-stat-row" data-help-key="stat_avg_wl">
      <span class="chart-stat-row__label">平均单笔盈利 / 亏损</span>
      <span class="chart-stat-row__value">
        <span class="kpi-card__sub--profit">${formatCurrency(stats.avgWin, 'CNY', false, 'wan')}</span>
        /
        <span class="kpi-card__sub--loss">${formatCurrency(stats.avgLoss, 'CNY', false, 'wan')}</span>
      </span>
    </div>
    <div class="chart-stat-row" data-help-key="stat_unrealized">
      <span class="chart-stat-row__label">在途浮动净盈亏</span>
      <span class="chart-stat-row__value kpi-card__sub--${getPnLClass(netUnrealized)}">
        ${formatCurrency(netUnrealized, 'CNY', true)}
      </span>
    </div>
    <div class="chart-stat-row" data-help-key="stat_realized">
      <span class="chart-stat-row__label">历史已平仓落袋盈亏</span>
      <span class="chart-stat-row__value kpi-card__sub--${getPnLClass(netRealized)}">
        ${formatCurrency(netRealized, 'CNY', true)} (${state.closedPositions.length}笔平仓)
      </span>
    </div>
    <div class="chart-stat-row" data-help-key="stat_best">
      <span class="chart-stat-row__label">最佳盈利贡献</span>
      <span class="chart-stat-row__value kpi-card__sub--profit" style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${bestStr}</span>
    </div>
    <div class="chart-stat-row" data-help-key="stat_worst">
      <span class="chart-stat-row__label">最大亏损拖累</span>
      <span class="chart-stat-row__value kpi-card__sub--loss" style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${worstStr}</span>
    </div>
  `;

  if (stats.totalCount === 0) {
    renderEmptyChart(pieContainer, '🎯', '暂无记录');
    return;
  }

  disposeChart(pieContainer);
  const chart = echarts.init(pieContainer, 'stockvault');

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (p) => `<b>${p.name}</b><br/>数量/规模：${p.value} (${p.percent}%)`
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10
    },
    series: [
      {
        name: '盈亏笔数分布',
        type: 'pie',
        radius: ['46%', '72%'],
        center: ['50%', '45%'],
        itemStyle: {
          borderRadius: 6,
          borderColor: 'rgba(15,23,42,0.8)',
          borderWidth: 2
        },
        label: {
          show: true,
          position: 'inside',
          formatter: '{d}%',
          fontSize: 11,
          fontWeight: 600,
          color: '#fff'
        },
        data: [
          { value: stats.winners.length, name: '盈利数', itemStyle: { color: profitColor } },
          { value: stats.losers.length, name: '亏损数', itemStyle: { color: lossColor } },
          ...(stats.flat.length > 0 ? [{ value: stats.flat.length, name: '持平', itemStyle: { color: '#64748b' } }] : [])
        ]
      }
    ]
  };

  chart.setOption(option);
  setupResize(chart);
}

/**
 * Module 4A: Monthly Return Heatmap Calendar Matrix
 */
function renderMonthlyMatrix() {
  const container = document.getElementById('chart-monthly-matrix');
  if (!container) return;

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1; // 1..12
  const isCN = getColorScheme() === 'cn';

  const snapshots = state.snapshotsCache.get('ALL') || [];
  const summary = state.summary || {};

  // Group snapshots by YYYY-MM for current year
  const monthMap = new Map();
  for (const s of snapshots) {
    if (!s.date) continue;
    const [y, m] = s.date.split('-').map(Number);
    if (y !== curYear) continue;
    if (!monthMap.has(m)) monthMap.set(m, []);
    monthMap.get(m).push(s);
  }

  let prevMonthEndPnl = null;
  const cellsHtml = [];

  for (let m = 1; m <= 12; m++) {
    const isCurrentMonth = m === curMonth;
    const isFutureMonth = m > curMonth;
    const mSnaps = monthMap.get(m) || [];

    let hasData = false;
    let mtdPct = 0;
    let mtdPnl = 0;

    if (isCurrentMonth && summary.totalValueCNY > 0) {
      hasData = true;
      mtdPct = Number(summary.totalMonthlyReturn ?? summary.portfolioMtdPercent ?? 0);
      mtdPnl = Number(summary.portfolioMtdPnlCNY ?? 0);
    } else if (mSnaps.length > 0) {
      hasData = true;
      const first = mSnaps[0];
      const last = mSnaps[mSnaps.length - 1];
      const startPnl = prevMonthEndPnl != null ? prevMonthEndPnl : (Number(first.totalPnlCNY) || 0);
      const endPnl = Number(last.totalPnlCNY) || 0;
      mtdPnl = endPnl - startPnl;
      const baseVal = Number(first.totalValueCNY) || Number(first.totalCostCNY) || 1;
      mtdPct = baseVal > 0 ? (mtdPnl / baseVal) * 100 : 0;
      prevMonthEndPnl = endPnl;
    }

    if (mSnaps.length > 0) {
      prevMonthEndPnl = Number(mSnaps[mSnaps.length - 1].totalPnlCNY) || 0;
    }

    // Compute subtle background tint based on return magnitude
    let bgStyle = '';
    let textClass = 'kpi-card__sub--neutral';
    if (hasData) {
      textClass = `kpi-card__sub--${getPnLClass(mtdPct)}`;
      const intensity = Math.min(0.28, Math.max(0.05, Math.abs(mtdPct) / 25));
      const isProfit = mtdPct >= 0;
      const rgb = (isProfit && isCN) || (!isProfit && !isCN) ? '239, 68, 68' : '16, 185, 129';
      if (Math.abs(mtdPct) > 0.01) {
        bgStyle = `background: rgba(${rgb}, ${intensity.toFixed(2)}); border-color: rgba(${rgb}, 0.25);`;
      }
    }

    const cellHelpKey = isCurrentMonth ? 'monthly_cell_live' : (hasData ? 'monthly_cell_hist' : '');
    cellsHtml.push(`
      <div class="monthly-cell ${isCurrentMonth ? 'monthly-cell--current' : ''}" style="${bgStyle}" ${cellHelpKey ? `data-help-key="${cellHelpKey}"` : ''}>
        <div class="monthly-cell__header">
          <span>${m}月</span>
          ${isCurrentMonth ? '<span class="monthly-cell__badge">本月实时</span>' : ''}
        </div>
        ${hasData ? `
          <div class="monthly-cell__pct ${textClass}">${formatPercent(mtdPct)}</div>
          <div class="monthly-cell__pnl ${textClass}">${formatCurrency(mtdPnl, 'CNY', true, 'wan')}</div>
        ` : `
          <div class="monthly-cell__pct" style="color:var(--color-text-muted);font-weight:400;font-size:0.85rem;">
            ${isFutureMonth ? '未到来' : '无快照'}
          </div>
          <div class="monthly-cell__pnl" style="color:var(--color-text-muted);">--</div>
        `}
      </div>
    `);
  }

  // Annual YTD summary footer inside the card
  const ytdPnl = summary.portfolioYtdPnlCNY || 0;
  const ytdPct = summary.portfolioYtdPercent || 0;
  const ytdClass = getPnLClass(ytdPnl);

  container.innerHTML = `
    <div class="monthly-matrix">
      ${cellsHtml.join('')}
    </div>
    <div data-help-key="monthly_ytd_bar" style="margin-top:12px;padding:10px 14px;border-radius:10px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;font-size:0.82rem;">
      <span style="color:var(--color-text-secondary);font-weight:500;">📅 ${curYear} 年度累计表现 (YTD) <span class="sv-help-icon">?</span></span>
      <span style="font-family:'JetBrains Mono',monospace;font-weight:700;" class="kpi-card__sub--${ytdClass}">
        ${formatCurrency(ytdPnl, 'CNY', true)} (${formatPercent(ytdPct)})
      </span>
    </div>
  `;
}

/**
 * Module 4B: Monthly Cash Flow (Buy vs Sell in CNY) & Trade Activity Chart
 */
function renderMonthlyTradesChart() {
  const container = document.getElementById('chart-monthly-trades');
  if (!container) return;

  const trades = state.trades || [];
  if (trades.length === 0) {
    renderEmptyChart(container, '🔄', '暂无历史交易流水记录');
    return;
  }

  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');
  const rates = state.summary?.exchangeRates || {};

  // Aggregate by YYYY-MM (last 12 active months)
  const monthlyMap = new Map();
  for (const t of trades) {
    const ym = (t.trade_date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    if (!monthlyMap.has(ym)) {
      monthlyMap.set(ym, { ym, buyCNY: 0, sellCNY: 0, count: 0 });
    }
    const row = monthlyMap.get(ym);
    const rate = Number(t.rate_to_cny) > 0 && t.currency !== 'CNY'
      ? Number(t.rate_to_cny)
      : getRateToCNY(t.currency || MARKETS[t.market]?.currency || 'CNY', rates);
    const amountCNY = (Number(t.price) || 0) * (Number(t.quantity) || 0) * rate;
    if (t.trade_type === 'BUY') row.buyCNY += amountCNY;
    else if (t.trade_type === 'SELL') row.sellCNY += amountCNY;
    row.count += 1;
  }

  const months = Array.from(monthlyMap.values())
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .slice(-12);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const m = months[idx];
        const net = m.buyCNY - m.sellCNY;
        return `
          <div style="font-weight:600;margin-bottom:4px;">${m.ym}（共 ${m.count} 笔交易）</div>
          <div>买入投入：<b>${formatCurrency(m.buyCNY)}</b></div>
          <div>卖出回笼：<b>${formatCurrency(m.sellCNY)}</b></div>
          <div style="margin-top:4px;border-top:1px solid rgba(148,163,184,0.15);padding-top:4px;">
            净流入(加减仓)：<b>${formatCurrency(net, 'CNY', true)}</b>
          </div>
        `;
      }
    },
    legend: {
      top: 0,
      right: 10,
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8
    },
    grid: { top: 30, bottom: 24, left: 12, right: 12, containLabel: true },
    xAxis: {
      type: 'category',
      data: months.map(m => m.ym.slice(2)), // e.g. 26-03
      axisLabel: { color: '#94a3b8', fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v) => Math.abs(v) >= 10000 ? (v / 10000).toFixed(0) + '万' : v
      }
    },
    series: [
      {
        name: '买入额',
        type: 'bar',
        stack: 'flow',
        barMaxWidth: 26,
        itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] },
        data: months.map(m => toFixed2(m.buyCNY))
      },
      {
        name: '卖出额',
        type: 'bar',
        stack: 'flow',
        barMaxWidth: 26,
        itemStyle: { color: '#f59e0b', borderRadius: [0, 0, 4, 4] },
        data: months.map(m => -toFixed2(m.sellCNY))
      },
      {
        name: '净流入',
        type: 'line',
        smooth: true,
        symbolSize: 5,
        lineStyle: { color: '#38bdf8', width: 2 },
        itemStyle: { color: '#38bdf8' },
        data: months.map(m => toFixed2(m.buyCNY - m.sellCNY))
      }
    ]
  };

  chart.setOption(option);
  setupResize(chart);
}

/**
 * Module 5A: Currency Cost vs Current Market Value Exposure
 */
function renderCurrencyExposureChart() {
  const container = document.getElementById('chart-currency-exposure');
  if (!container) return;

  const positions = (state.summary?.positions || []).filter(p => p.status === 'OPEN' || !p.status);
  if (positions.length === 0) {
    renderEmptyChart(container, '💱', '暂无多币种敞口数据');
    return;
  }

  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');

  const exposureMap = {};
  for (const p of positions) {
    const cur = p.currency || MARKETS[p.market]?.currency || 'CNY';
    if (!exposureMap[cur]) {
      exposureMap[cur] = { currency: cur, costCNY: 0, valueCNY: 0, pnlCNY: 0, count: 0 };
    }
    exposureMap[cur].costCNY += Number(p.costCNY) || 0;
    exposureMap[cur].valueCNY += Number(p.marketValueCNY) || 0;
    exposureMap[cur].pnlCNY += Number(p.pnlCNY) || 0;
    exposureMap[cur].count += 1;
  }

  const list = Object.values(exposureMap).sort((a, b) => b.valueCNY - a.valueCNY);
  const totalPortfolioVal = list.reduce((s, i) => s + i.valueCNY, 0) || 1;

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const item = list[idx];
        const pnlPct = item.costCNY > 0 ? (item.pnlCNY / item.costCNY) * 100 : 0;
        const share = (item.valueCNY / totalPortfolioVal) * 100;
        return `
          <div style="font-weight:600;margin-bottom:4px;">${CURRENCY_LABELS[item.currency] || item.currency}（${item.count} 支）</div>
          <div>投入成本(CNY)：<b>${formatCurrency(item.costCNY)}</b></div>
          <div>当前市值(CNY)：<b>${formatCurrency(item.valueCNY)}</b> (占总资产 ${share.toFixed(1)}%)</div>
          <div>浮动盈亏(CNY)：<b>${formatCurrency(item.pnlCNY, 'CNY', true)} (${formatPercent(pnlPct)})</b></div>
        `;
      }
    },
    legend: {
      top: 0,
      right: 10,
      textStyle: { color: '#94a3b8', fontSize: 11 }
    },
    grid: { top: 32, bottom: 24, left: 12, right: 40, containLabel: true },
    xAxis: {
      type: 'category',
      data: list.map(i => CURRENCY_LABELS[i.currency] || i.currency),
      axisLabel: { color: '#cbd5e1', fontSize: 11 }
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: {
          formatter: (v) => v >= 10000 ? (v / 10000).toFixed(0) + '万' : v
        }
      },
      {
        type: 'value',
        splitLine: { show: false },
        axisLabel: { formatter: (v) => `${v}%` }
      }
    ],
    series: [
      {
        name: '投入成本',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { color: '#475569', borderRadius: [4, 4, 0, 0] },
        data: list.map(i => toFixed2(i.costCNY))
      },
      {
        name: '当前市值',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] },
        data: list.map(i => toFixed2(i.valueCNY))
      },
      {
        name: '收益率%',
        type: 'line',
        yAxisIndex: 1,
        symbolSize: 6,
        lineStyle: { color: '#f59e0b', width: 2 },
        itemStyle: { color: '#f59e0b' },
        data: list.map(i => i.costCNY > 0 ? toFixed2((i.pnlCNY / i.costCNY) * 100) : 0)
      }
    ]
  };

  chart.setOption(option);
  setupResize(chart);
}

/**
 * Module 5B: Portfolio Concentration Pareto Chart (CR3 / CR5 / Cumulative Weight)
 */
function renderConcentrationParetoChart() {
  const container = document.getElementById('chart-concentration-pareto');
  const badgesContainer = document.getElementById('concentration-badges');
  if (!container) return;

  const positions = (state.summary?.positions || [])
    .filter(p => (p.status === 'OPEN' || !p.status) && (p.marketValueCNY || 0) > 0)
    .sort((a, b) => (b.marketValueCNY || 0) - (a.marketValueCNY || 0));

  if (positions.length === 0) {
    renderEmptyChart(container, '🧱', '暂无持仓集中度数据');
    return;
  }

  disposeChart(container);
  const chart = echarts.init(container, 'stockvault');

  const totalVal = positions.reduce((s, p) => s + (p.marketValueCNY || 0), 0) || 1;
  const weights = positions.map(p => ((p.marketValueCNY || 0) / totalVal) * 100);

  const cr3 = weights.slice(0, 3).reduce((s, w) => s + w, 0);
  const cr5 = weights.slice(0, 5).reduce((s, w) => s + w, 0);
  const hhi = weights.reduce((s, w) => s + (w / 100) ** 2, 0);
  const riskLabel = hhi > 0.25 ? '高度集中' : (hhi > 0.15 ? '适度集中' : '均衡分散');

  if (badgesContainer) {
    badgesContainer.innerHTML = `
      <span class="concentration-badge" data-help-key="badge_cr3">CR3: <b>${cr3.toFixed(1)}%</b></span>
      <span class="concentration-badge" data-help-key="badge_cr5">CR5: <b>${cr5.toFixed(1)}%</b></span>
      <span class="concentration-badge" data-help-key="badge_hhi">${riskLabel} (HHI ${(hhi * 10000).toFixed(0)})</span>
    `;
  }

  // Show top 10 stocks in Pareto chart
  const topList = positions.slice(0, 10);
  let cumWeight = 0;
  const cumWeights = topList.map(p => {
    const w = ((p.marketValueCNY || 0) / totalVal) * 100;
    cumWeight += w;
    return toFixed2(cumWeight);
  });

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const p = topList[idx];
        const w = ((p.marketValueCNY || 0) / totalVal) * 100;
        return `
          <div style="font-weight:600;margin-bottom:4px;">#${idx + 1} ${p.name} (${p.symbol})</div>
          <div>持仓市值：<b>${formatCurrency(p.marketValueCNY)}</b></div>
          <div>单票占比：<b>${w.toFixed(2)}%</b></div>
          <div>前 ${idx + 1} 大累计占比：<b>${cumWeights[idx]}%</b></div>
        `;
      }
    },
    grid: { top: 28, bottom: 28, left: 12, right: 36, containLabel: true },
    xAxis: {
      type: 'category',
      data: topList.map(p => p.name.length > 5 ? p.name.slice(0, 5) + '…' : p.name),
      axisLabel: { color: '#94a3b8', fontSize: 10, interval: 0, rotate: topList.length > 6 ? 20 : 0 }
    },
    yAxis: [
      {
        type: 'value',
        name: '市值',
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        axisLabel: {
          formatter: (v) => v >= 10000 ? (v / 10000).toFixed(0) + '万' : v
        }
      },
      {
        type: 'value',
        name: '累计占比',
        min: 0,
        max: 100,
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
        axisLabel: { formatter: (v) => `${v}%` }
      }
    ],
    series: [
      {
        name: '个股市值',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#8b5cf6' },
            { offset: 1, color: '#6366f1' }
          ]),
          borderRadius: [4, 4, 0, 0]
        },
        data: topList.map(p => toFixed2(p.marketValueCNY || 0))
      },
      {
        name: '累计仓位占比',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 6,
        lineStyle: { color: '#10b981', width: 2.2 },
        itemStyle: { color: '#10b981' },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: 'rgba(245, 158, 11, 0.45)', type: 'dashed' },
          data: [{ yAxis: 80, label: { formatter: '80% 集中线', color: '#f59e0b', fontSize: 10 } }]
        },
        data: cumWeights
      }
    ]
  };

  chart.setOption(option);
  setupResize(chart);
}

/**
 * Setup floating hover tooltip for metric meaning & calculation formula
 */
function setupMetricTooltips(container) {
  document.getElementById('sv-metric-tooltip')?.remove();
  const tooltip = document.createElement('div');
  tooltip.id = 'sv-metric-tooltip';
  tooltip.className = 'sv-help-tooltip';
  document.body.appendChild(tooltip);

  let activeTarget = null;

  const positionTooltip = (e) => {
    const pad = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = tooltip.getBoundingClientRect();
    let left = e.clientX + pad;
    let top = e.clientY + pad;

    if (left + rect.width > vw - 10) {
      left = Math.max(10, e.clientX - rect.width - pad);
    }
    if (top + rect.height > vh - 10) {
      top = Math.max(10, e.clientY - rect.height - pad);
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const onMouseOver = (e) => {
    const el = e.target.closest('[data-help-key]');
    if (!el) return;
    const key = el.getAttribute('data-help-key');
    const info = METRIC_HELP[key];
    if (!info) return;

    activeTarget = el;
    tooltip.innerHTML = `
      <div class="sv-help-tooltip__title">${info.title}</div>
      <div class="sv-help-tooltip__row">
        <span class="sv-help-tooltip__tag">含义</span>${info.meaning}
      </div>
      <div class="sv-help-tooltip__row">
        <span class="sv-help-tooltip__tag sv-help-tooltip__tag--formula">计算方式</span>
        <span class="sv-help-tooltip__formula">${info.formula}</span>
      </div>
    `;
    tooltip.classList.add('sv-help-tooltip--visible');
    positionTooltip(e);
  };

  const onMouseMove = (e) => {
    if (!activeTarget) return;
    positionTooltip(e);
  };

  const onMouseOut = (e) => {
    if (!activeTarget) return;
    const related = e.relatedTarget;
    if (related && activeTarget.contains(related)) return;
    const nextTarget = related?.closest?.('[data-help-key]');
    if (nextTarget === activeTarget) return;

    activeTarget = null;
    tooltip.classList.remove('sv-help-tooltip--visible');
  };

  container.addEventListener('mouseover', onMouseOver);
  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('mouseout', onMouseOut);

  return () => {
    container.removeEventListener('mouseover', onMouseOver);
    container.removeEventListener('mousemove', onMouseMove);
    container.removeEventListener('mouseout', onMouseOut);
    tooltip.remove();
  };
}

/**
 * Render friendly empty placeholder inside a chart container
 */
function renderEmptyChart(container, icon, text) {
  disposeChart(container);
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--color-text-secondary);gap:10px;">
      <span style="font-size:2.2rem;">${icon}</span>
      <span style="font-size:0.88rem;">${text}</span>
    </div>
  `;
}
