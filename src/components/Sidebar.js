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
  { route: ROUTES.CHARTS, icon: 'charts', label: '图表分析', lucide: 'line-chart', mobileHide: true },
  { route: ROUTES.TRADES, icon: 'trades', label: '交易记录', lucide: 'receipt', mobileHide: true },
  { route: ROUTES.IMPORT_EXPORT, icon: 'import', label: '导入导出', lucide: 'download-cloud', mobileHide: true },
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
              ${item.mobileHide ? 'data-mobile-hide="true"' : ''}
              title="${item.label}">
        <span class="sidebar__icon"><i data-lucide="${item.lucide}"></i></span>
        <span class="sidebar__label">${item.label}</span>
      </button>
    `;
  }).join('');

  // 隐藏项（用于 "更多" 弹出菜单）
  const hiddenNavHTML = NAV_ITEMS.filter(item => item.mobileHide).map(item => {
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
        <!-- "更多" 按钮 — 仅移动端可见 -->
        <button class="sidebar__item sidebar__more-btn" id="sidebar-more-btn" title="更多">
          <span class="sidebar__icon"><i data-lucide="ellipsis"></i></span>
          <span class="sidebar__label">更多</span>
        </button>
      </div>
      <div class="sidebar__footer">
        <div class="sidebar__version">v${__APP_VERSION__}</div>
      </div>
    </nav>

    <!-- "更多" 弹出菜单 -->
    <div class="sidebar__more-backdrop" id="sidebar-more-backdrop"></div>
    <div class="sidebar__more-menu" id="sidebar-more-menu">
      ${hiddenNavHTML}
    </div>
  `;
  
  // 使用事件委托 — 主导航和更多菜单
  const handleNavClick = (e) => {
    const btn = e.target.closest('[data-route]');
    if (btn) {
      const route = btn.getAttribute('data-route');
      closeMoreMenu();
      navigate(route);
    }
  };

  container.addEventListener('click', handleNavClick);

  // "更多" 弹出菜单逻辑
  const moreBtn = container.querySelector('#sidebar-more-btn');
  const moreMenu = container.querySelector('#sidebar-more-menu');
  const moreBackdrop = container.querySelector('#sidebar-more-backdrop');

  function closeMoreMenu() {
    moreMenu?.classList.remove('sidebar__more-menu--open');
    moreBackdrop?.classList.remove('sidebar__more-backdrop--open');
  }

  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = moreMenu.classList.contains('sidebar__more-menu--open');
    if (isOpen) {
      closeMoreMenu();
    } else {
      moreMenu.classList.add('sidebar__more-menu--open');
      moreBackdrop.classList.add('sidebar__more-backdrop--open');
    }
  });

  moreBackdrop?.addEventListener('click', closeMoreMenu);

  // 监听更多菜单中的导航点击
  moreMenu?.addEventListener('click', handleNavClick);
}

