/**
 * StockVault — 侧边栏导航组件
 */

import { navigate, getCurrentPath } from '../router/index.js';
import { ROUTES } from '../utils/constants.js';

const NAV_ITEMS = [
  { route: ROUTES.DASHBOARD, icon: 'dashboard', label: '仪表盘', emoji: '📊' },
  { route: ROUTES.POSITIONS, icon: 'positions', label: '持仓管理', emoji: '📋' },
  { route: ROUTES.TRADE, icon: 'trade', label: '交易录入', emoji: '📝' },
  { route: ROUTES.MARKET, icon: 'market', label: '市场专区', emoji: '🌍' },
  { route: ROUTES.CHARTS, icon: 'charts', label: '图表分析', emoji: '📈' },
  { route: ROUTES.TRADES, icon: 'trades', label: '交易记录', emoji: '🧾' },
  { route: ROUTES.IMPORT_EXPORT, icon: 'import', label: '导入导出', emoji: '📥' },
  { route: ROUTES.SETTINGS, icon: 'settings', label: '设置', emoji: '⚙️' }
];

/**
 * 渲染侧边栏
 * @param {HTMLElement} container
 */
export function renderSidebar(container) {
  const currentPath = getCurrentPath() || '/';
  
  const navHTML = NAV_ITEMS.map(item => {
    const isActive = currentPath === item.route || 
      (item.route !== '/' && currentPath.startsWith(item.route));
    
    return `
      <button class="sidebar__item ${isActive ? 'sidebar__item--active' : ''}" 
              data-route="${item.route}"
              title="${item.label}">
        <span class="sidebar__icon">${item.emoji}</span>
        <span class="sidebar__label">${item.label}</span>
      </button>
    `;
  }).join('');
  
  container.innerHTML = `
    <nav class="sidebar">
      <div class="sidebar__nav">
        ${navHTML}
      </div>
      <div class="sidebar__footer">
        <div class="sidebar__version">v1.10</div>
      </div>
    </nav>
  `;
  
  // 使用事件委托
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-route]');
    if (btn) {
      const route = btn.getAttribute('data-route');
      navigate(route);
    }
  });
}
