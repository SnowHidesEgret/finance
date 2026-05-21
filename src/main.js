/**
 * StockVault — 应用入口
 */

import './styles/index.css';
import './styles/components.css';
import './styles/dashboard.css';
import './styles/charts.css';
import './styles/animations.css';

import { route, initRouter, navigate } from './router/index.js';
import { initColorScheme } from './utils/colorScheme.js';
import { settingsStore } from './store/index.js';
import { renderHeader } from './components/Header.js';
import { renderSidebar } from './components/Sidebar.js';
import { renderExchangeRateBar } from './components/ExchangeRateBar.js';

// 页面模块 — 延迟导入
const pageModules = {
  dashboard: () => import('./pages/DashboardPage.js'),
  positions: () => import('./pages/PositionsPage.js'),
  trade: () => import('./pages/TradePage.js'),
  charts: () => import('./pages/ChartsPage.js'),
  market: () => import('./pages/MarketPage.js'),
  importExport: () => import('./pages/ImportExportPage.js'),
  settings: () => import('./pages/SettingsPage.js')
};

/**
 * 初始化应用
 */
async function init() {
  // 1. 应用配色方案
  initColorScheme();
  
  // 2. 渲染应用骨架
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-layout">
      <aside class="app-layout__sidebar" id="sidebar"></aside>
      <div class="app-layout__main">
        <header class="app-layout__header" id="header"></header>
        <main class="app-layout__content" id="page-content">
          <div class="page-loading">
            <div class="skeleton skeleton--card"></div>
            <div class="skeleton skeleton--card"></div>
          </div>
        </main>
        <footer class="app-layout__footer" id="exchange-rate-bar"></footer>
      </div>
    </div>
  `;
  
  // 3. 渲染全局组件
  renderHeader(document.getElementById('header'));
  renderSidebar(document.getElementById('sidebar'));
  renderExchangeRateBar(document.getElementById('exchange-rate-bar'));
  
  // 4. 注册路由
  route('/', async (container) => {
    const { renderDashboardPage } = await pageModules.dashboard();
    renderDashboardPage(container);
  });
  
  route('/positions', async (container) => {
    const { renderPositionsPage } = await pageModules.positions();
    renderPositionsPage(container);
  });
  
  route('/trade', async (container) => {
    const { renderTradePage } = await pageModules.trade();
    renderTradePage(container);
  });
  
  route('/charts', async (container) => {
    const { renderChartsPage } = await pageModules.charts();
    renderChartsPage(container);
  });
  
  route('/market', async (container, params) => {
    const { renderMarketPage } = await pageModules.market();
    renderMarketPage(container, params);
  });
  
  route('/market/:id', async (container, params) => {
    const { renderMarketPage } = await pageModules.market();
    renderMarketPage(container, params);
  });
  
  route('/import-export', async (container) => {
    const { renderImportExportPage } = await pageModules.importExport();
    renderImportExportPage(container);
  });
  
  route('/settings', async (container) => {
    const { renderSettingsPage } = await pageModules.settings();
    renderSettingsPage(container);
  });
  
  // 5. 启动路由
  initRouter();
  
  console.log('[StockVault] 应用已启动 ✨');
}

// 启动
document.addEventListener('DOMContentLoaded', init);
