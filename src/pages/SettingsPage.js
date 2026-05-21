/**
 * StockVault — 设置页
 */
import { getColorScheme, setColorScheme } from '../utils/colorScheme.js';
import { COLOR_SCHEMES } from '../utils/constants.js';

export async function renderSettingsPage(container) {
  const currentScheme = getColorScheme();
  
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">系统设置</h2>
      </div>
      
      <div class="card" style="max-width: 600px;">
        <h3 style="margin-bottom:24px; font-size:1.1rem; border-bottom:1px solid var(--color-border); padding-bottom:12px;">显示偏好</h3>
        
        <div class="form-group" style="margin-bottom:24px;">
          <label class="form-label" style="font-size:1rem; font-weight:600; color:var(--color-text-primary)">盈亏颜色方案</label>
          <p style="font-size:0.875rem; color:var(--color-text-secondary); margin-bottom:12px;">选择上涨和下跌的代表颜色。中国大陆市场习惯红涨绿跌，而国际市场通用绿涨红跌。</p>
          
          <div style="display:flex; gap:16px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid ${currentScheme === 'cn' ? 'var(--color-accent)' : 'transparent'}">
              <input type="radio" name="color_scheme" value="cn" ${currentScheme === 'cn' ? 'checked' : ''} onchange="window.handleSchemeChange('cn')">
              <div>
                <div style="font-weight:500;">红涨绿跌 (CN)</div>
                <div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:4px;">
                  <span style="color:#ef4444">▲ 上涨</span> / <span style="color:#10b981">▼ 下跌</span>
                </div>
              </div>
            </label>
            
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid ${currentScheme === 'intl' ? 'var(--color-accent)' : 'transparent'}">
              <input type="radio" name="color_scheme" value="intl" ${currentScheme === 'intl' ? 'checked' : ''} onchange="window.handleSchemeChange('intl')">
              <div>
                <div style="font-weight:500;">绿涨红跌 (INTL)</div>
                <div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:4px;">
                  <span style="color:#10b981">▲ 上涨</span> / <span style="color:#ef4444">▼ 下跌</span>
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
  
  window.handleSchemeChange = (scheme) => {
    setColorScheme(scheme);
    // Reload page to re-render selected border and apply scheme fully to charts
    renderSettingsPage(container);
  };
}
