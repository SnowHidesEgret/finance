/**
 * StockVault — Hash Router
 * 轻量级 SPA 路由，基于 hash 导航
 */

import { ROUTES } from '../utils/constants.js';

/** @type {Map<string, Function>} */
const routes = new Map();

/** @type {Function|null} */
let notFoundHandler = null;

/** @type {string} */
let currentPath = '';

/** @type {Function[]} */
const beforeHooks = [];

/**
 * 注册路由
 * @param {string} path - 路由路径 (如 '/', '/positions')
 * @param {Function} handler - 页面渲染函数 (containerEl) => void
 */
export function route(path, handler) {
  routes.set(path, handler);
}

/**
 * 设置 404 页面处理
 * @param {Function} handler
 */
export function setNotFound(handler) {
  notFoundHandler = handler;
}

/**
 * 添加路由前置钩子
 * @param {Function} hook - (from, to) => boolean，返回 false 阻止导航
 */
export function beforeEach(hook) {
  beforeHooks.push(hook);
}

/**
 * 导航到指定路由
 * @param {string} path
 */
export function navigate(path) {
  window.location.hash = '#' + path;
}

/**
 * 获取当前路由路径
 * @returns {string}
 */
export function getCurrentPath() {
  return currentPath;
}

/**
 * 解析当前 hash
 * @returns {{ path: string, params: Object }}
 */
function parseHash() {
  const hash = window.location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = {};
  
  if (query) {
    const searchParams = new URLSearchParams(query);
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
  }
  
  return { path: path || '/', params };
}

/**
 * 处理路由变化
 */
async function handleRoute() {
  const { path, params } = parseHash();
  const previousPath = currentPath;
  
  // 执行前置钩子
  for (const hook of beforeHooks) {
    if (hook(previousPath, path) === false) {
      // 恢复 hash
      window.location.hash = '#' + previousPath;
      return;
    }
  }
  
  currentPath = path;
  
  // 查找匹配的路由
  let handler = routes.get(path);
  
  // 尝试带参数路由匹配 (如 /market/:id)
  if (!handler) {
    for (const [routePath, routeHandler] of routes) {
      if (routePath.includes(':')) {
        const regex = new RegExp(
          '^' + routePath.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'
        );
        const match = path.match(regex);
        if (match) {
          handler = routeHandler;
          Object.assign(params, match.groups);
          break;
        }
      }
    }
  }
  
  // 获取页面容器
  const container = document.getElementById('page-content');
  if (!container) return;
  
  // 添加页面退出动画
  container.classList.add('page-exit');
  await new Promise(r => setTimeout(r, 150));
  
  // 清空容器
  container.innerHTML = '';
  container.classList.remove('page-exit');
  
  if (handler) {
    // 添加页面进入动画
    container.classList.add('page-enter');
    handler(container, params);
    requestAnimationFrame(() => {
      container.classList.remove('page-enter');
    });
  } else if (notFoundHandler) {
    notFoundHandler(container);
  } else {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <h2 class="empty-state__title">页面未找到</h2>
        <p class="empty-state__text">请从左侧导航栏选择页面</p>
      </div>
    `;
  }
  
  // 更新侧边栏激活状态
  updateActiveNav(path);
}

/**
 * 更新导航栏激活项
 * @param {string} path
 */
function updateActiveNav(path) {
  document.querySelectorAll('[data-route]').forEach(el => {
    const route = el.getAttribute('data-route');
    const isActive = path === route || (route !== '/' && path.startsWith(route + '/'));
    el.classList.toggle('sidebar__item--active', isActive);
  });
}

/**
 * 初始化路由
 */
export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  
  // 初始路由
  if (!window.location.hash) {
    window.location.hash = '#/';
  } else {
    handleRoute();
  }
}

/**
 * 销毁路由（清理）
 */
export function destroyRouter() {
  window.removeEventListener('hashchange', handleRoute);
}
