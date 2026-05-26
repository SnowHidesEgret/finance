/**
 * StockVault — Font Size Management
 */

import { FONT_SIZES, DEFAULT_SETTINGS } from './constants.js';

const STORAGE_KEY = 'stockvault_font_size';

export function getFontSize() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_SETTINGS.fontSize;
}

export function setFontSize(size) {
  if (!Object.values(FONT_SIZES).includes(size)) {
    console.warn(`[FontSize] Invalid size: ${size}`);
    return;
  }
  
  localStorage.setItem(STORAGE_KEY, size);
  applyFontSize(size);
}

export function applyFontSize(size) {
  const s = size || getFontSize();
  document.documentElement.setAttribute('data-font-size', s);
}

export function initFontSize() {
  applyFontSize();
}
