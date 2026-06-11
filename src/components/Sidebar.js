/**
 * StockVault — 侧边栏导航组件
 */

import { navigate, getCurrentPath } from '../router/index.js';
import { ROUTES } from '../utils/constants.js';

const NAV_ITEMS = [
  { route: ROUTES.DASHBOARD, icon: 'layout-dashboard', label: '仪表盘', lucide: 'layout-dashboard' },
  { route: ROUTES.POSITIONS, icon: 'positions', label: '持仓管理', lucide: 'briefcase' },
  { route: ROUTES.TRADE, icon: 'trade', label: '交易录入', lucide: 'pen-square' },
  { route: ROUTES.MARKET, icon: 'market', label: '市场专区', lucide: 'globe' },
  { route: ROUTES.CHARTS, icon: 'charts', label: '图表分析', lucide: 'line-chart' },
  { route: ROUTES.TRADES, icon: 'trades', label: '交易记录', lucide: 'receipt' },
  { route: ROUTES.IMPORT_EXPORT, icon: 'import', label: '导入导出', lucide: 'download-cloud' },
  { route: ROUTES.SETTINGS, icon: 'settings', label: '设置', lucide: 'settings' }
];

/**
 * 渲染侧边栏
 * @param {HTMLElement} container
 */
export function renderSidebar(container) {
  const currentPath = getCurrentPath() || '/';
  
  const navHTML = NAV_ITEMS.map(item => {
    const isActive = currentPath === item.route || 
      (item.route !== '/' && currentPath.startsWith(item.route + '/'));
    
    return `
      <button class="sidebar__item ${isActive ? 'sidebar__item--active' : ''}" 
              data-route="${item.route}"
              title="${item.label}">
        <span class="sidebar__icon"><i data-lucide="${item.lucide}"></i></span>
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
        <div class="sidebar__version">v2.3.0</div>
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
