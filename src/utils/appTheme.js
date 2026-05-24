/**
 * StockVault — App Theme Management (Dark / Light)
 */

export const APP_THEMES = { DARK: 'dark', LIGHT: 'light' };
const STORAGE_KEY = 'stockvault_app_theme';

export function getAppTheme() {
  return localStorage.getItem(STORAGE_KEY) || APP_THEMES.DARK;
}

export function setAppTheme(theme) {
  if (!Object.values(APP_THEMES).includes(theme)) {
    console.warn(`[AppTheme] Invalid theme: ${theme}`);
    return;
  }
  
  localStorage.setItem(STORAGE_KEY, theme);
  applyAppTheme(theme);
}

export function applyAppTheme(theme) {
  const t = theme || getAppTheme();
  document.documentElement.setAttribute('data-theme', t);
}

export function initAppTheme() {
  applyAppTheme();
}
