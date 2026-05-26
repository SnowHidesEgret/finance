/**
 * StockVault — 应用入口
 */

import './styles/index.css';
import './styles/components.css';
import './styles/dashboard.css';
import './styles/charts.css';
import './styles/animations.css';

import { route, initRouter, navigate, beforeEach } from './router/index.js';
import { initColorScheme } from './utils/colorScheme.js';
import { initAppTheme } from './utils/appTheme.js';
import { initFontSize } from './utils/fontSize.js';
import { settingsStore } from './store/index.js';
import { renderHeader } from './components/Header.js';
import { renderSidebar } from './components/Sidebar.js';
import { renderExchangeRateBar } from './components/ExchangeRateBar.js';

// 页面模块 — 延迟导入
const pageModules = {
  dashboard: () => import('./pages/DashboardPage.js'),
  positions: () => import('./pages/PositionsPage.js'),
  trade: () => import('./pages/TradePage.js'),
  trades: () => import('./pages/TradesPage.js'),
  charts: () => import('./pages/ChartsPage.js'),
  market: () => import('./pages/MarketPage.js'),
  importExport: () => import('./pages/ImportExportPage.js'),
  settings: () => import('./pages/SettingsPage.js'),
  login: () => import('./pages/LoginPage.js')
};

/**
 * 初始化应用
 */
async function init() {
  // 1. 应用配色方案
  initColorScheme();
  initAppTheme();
  initFontSize();
  
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

  route('/trades', async (container) => {
    const { renderTradesPage } = await pageModules.trades();
    renderTradesPage(container);
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
  
  route('/login', async (container) => {
    const { renderLoginPage } = await pageModules.login();
    renderLoginPage(container);
  });
  
  // 5. 路由拦截与布局切换
  beforeEach((from, to) => {
    const token = localStorage.getItem('auth_token');
    if (!token && to !== '/login') {
      navigate('/login');
      return false;
    }
    if (token && to === '/login') {
      navigate('/');
      return false;
    }
    
    if (to === '/login') {
      document.body.classList.add('login-layout');
    } else {
      document.body.classList.remove('login-layout');
    }
  });

  // 6. 启动路由
  initRouter();
  
  // 7. 自动刷新逻辑
  let refreshTimer = setInterval(() => {
    window.dispatchEvent(new CustomEvent('stockvault:refresh'));
  }, settingsStore.get('refreshInterval'));

  // 监听设置中的刷新时间变化
  settingsStore.on('refreshInterval', (newVal) => {
    clearInterval(refreshTimer);
    if (newVal > 0) {
      refreshTimer = setInterval(() => {
        window.dispatchEvent(new CustomEvent('stockvault:refresh'));
      }, newVal);
    }
  });
  
  console.log('[StockVault] 应用已启动 ✨');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
