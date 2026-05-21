/**
 * StockVault — 顶部导航栏组件
 */

import { navigate } from '../router/index.js';

/**
 * 渲染顶部导航栏
 * @param {HTMLElement} container
 */
export function renderHeader(container) {
  container.innerHTML = `
    <div class="header">
      <div class="header__left">
        <button class="header__menu-btn btn btn--icon" id="sidebar-toggle" aria-label="切换侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <div class="header__brand" role="button" tabindex="0">
          <div class="header__logo">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <defs>
                <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#6366f1"/>
                  <stop offset="100%" stop-color="#8b5cf6"/>
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="8" fill="url(#hg)"/>
              <path d="M8 22 L12 16 L16 19 L20 11 L24 14" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              <circle cx="24" cy="14" r="2" fill="white"/>
            </svg>
          </div>
          <h1 class="header__title">StockVault</h1>
        </div>
      </div>
      <div class="header__center">
        <div class="header__status" id="header-status">
          <span class="header__status-dot animate-pulse"></span>
          <span class="header__status-text">就绪</span>
        </div>
      </div>
      <div class="header__right">
        <button class="btn btn--ghost btn--icon" id="btn-refresh" title="刷新行情">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
        <button class="btn btn--ghost btn--icon" id="btn-add-trade" title="新建交易">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>
    </div>
  `;
  
  // 事件绑定
  container.querySelector('#sidebar-toggle')?.addEventListener('click', () => {
    document.querySelector('.app-layout')?.classList.toggle('app-layout--sidebar-collapsed');
  });
  
  container.querySelector('.header__brand')?.addEventListener('click', () => {
    navigate('/');
  });
  
  container.querySelector('#btn-add-trade')?.addEventListener('click', () => {
    navigate('/trade');
  });
  
  container.querySelector('#btn-refresh')?.addEventListener('click', () => {
    // 触发全局刷新事件
    window.dispatchEvent(new CustomEvent('stockvault:refresh'));
    updateStatus('刷新中...', true);
    setTimeout(() => updateStatus('就绪', false), 3000);
  });
}

/**
 * 更新状态显示
 * @param {string} text
 * @param {boolean} [loading=false]
 */
export function updateStatus(text, loading = false) {
  const statusEl = document.getElementById('header-status');
  if (!statusEl) return;
  
  const dot = statusEl.querySelector('.header__status-dot');
  const textEl = statusEl.querySelector('.header__status-text');
  
  if (textEl) textEl.textContent = text;
  if (dot) {
    dot.classList.toggle('animate-pulse', loading);
    dot.style.background = loading ? '#f59e0b' : '#10b981';
  }
}
