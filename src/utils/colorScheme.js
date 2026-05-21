/**
 * StockVault — 配色方案管理（红涨绿跌 / 绿涨红跌）
 */

import { COLOR_SCHEMES, DEFAULT_SETTINGS } from './constants.js';

const STORAGE_KEY = 'stockvault_color_scheme';

/**
 * 获取当前配色方案
 * @returns {string} 'cn' | 'intl'
 */
export function getColorScheme() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_SETTINGS.colorScheme;
}

/**
 * 设置配色方案并立即应用
 * @param {string} scheme - 'cn' (红涨绿跌) | 'intl' (绿涨红跌)
 */
export function setColorScheme(scheme) {
  if (!Object.values(COLOR_SCHEMES).includes(scheme)) {
    console.warn(`[ColorScheme] Invalid scheme: ${scheme}`);
    return;
  }
  
  localStorage.setItem(STORAGE_KEY, scheme);
  applyColorScheme(scheme);
}

/**
 * 切换配色方案
 * @returns {string} 切换后的方案
 */
export function toggleColorScheme() {
  const current = getColorScheme();
  const next = current === COLOR_SCHEMES.CN ? COLOR_SCHEMES.INTL : COLOR_SCHEMES.CN;
  setColorScheme(next);
  return next;
}

/**
 * 应用配色方案到 DOM
 * @param {string} [scheme]
 */
export function applyColorScheme(scheme) {
  const s = scheme || getColorScheme();
  document.documentElement.setAttribute('data-color-scheme', s);
}

/**
 * 初始化配色方案（页面加载时调用）
 */
export function initColorScheme() {
  applyColorScheme();
}

/**
 * 获取当前配色方案的显示名称
 * @returns {string}
 */
export function getColorSchemeLabel() {
  return getColorScheme() === COLOR_SCHEMES.CN ? '红涨绿跌' : '绿涨红跌';
}
