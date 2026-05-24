/**
 * StockVault — 设置页
 */
import { put } from '../services/api.js';
import { getColorScheme, setColorScheme } from '../utils/colorScheme.js';
import { getAppTheme, setAppTheme } from '../utils/appTheme.js';
import { COLOR_SCHEMES } from '../utils/constants.js';

export async function renderSettingsPage(container) {
  const currentScheme = getColorScheme();
  const currentTheme = getAppTheme();
  
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

        <div class="form-group" style="margin-bottom:24px;">
          <label class="form-label" style="font-size:1rem; font-weight:600; color:var(--color-text-primary)">背景主题</label>
          <p style="font-size:0.875rem; color:var(--color-text-secondary); margin-bottom:12px;">选择深色或浅色背景界面。</p>
          
          <div style="display:flex; gap:16px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid ${currentTheme === 'dark' ? 'var(--color-accent)' : 'transparent'}">
              <input type="radio" name="app_theme" value="dark" ${currentTheme === 'dark' ? 'checked' : ''} onchange="window.handleThemeChange('dark')">
              <div>
                <div style="font-weight:500;">深色主题 (Dark)</div>
              </div>
            </label>
            
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid ${currentTheme === 'light' ? 'var(--color-accent)' : 'transparent'}">
              <input type="radio" name="app_theme" value="light" ${currentTheme === 'light' ? 'checked' : ''} onchange="window.handleThemeChange('light')">
              <div>
                <div style="font-weight:500;">浅色主题 (Light)</div>
              </div>
            </label>
          </div>
        </div>

      </div>

      <div class="card" style="max-width: 600px; margin-top: 24px;">
        <h3 style="margin-bottom:24px; font-size:1.1rem; border-bottom:1px solid var(--color-border); padding-bottom:12px;">安全设置</h3>
        <form id="password-form">
          <div class="form-group" style="margin-bottom:16px;">
            <label class="form-label" style="font-size:0.875rem; color:var(--color-text-secondary)">原密码</label>
            <input type="password" id="old-password" class="form-control" placeholder="输入当前密码" required>
          </div>
          <div class="form-group" style="margin-bottom:16px;">
            <label class="form-label" style="font-size:0.875rem; color:var(--color-text-secondary)">新密码</label>
            <input type="password" id="new-password" class="form-control" placeholder="输入新密码" required>
          </div>
          <div id="pwd-msg" style="font-size:0.875rem; margin-bottom:16px; display:none;"></div>
          <button type="submit" class="btn btn--primary" id="pwd-btn">修改密码</button>
          <button type="button" class="btn btn--danger" id="logout-btn" style="margin-left: 12px; background: transparent; border: 1px solid var(--color-loss); color: var(--color-loss);">退出登录</button>
        </form>
      </div>

    </div>
  `;
  
  window.handleSchemeChange = (scheme) => {
    setColorScheme(scheme);
    renderSettingsPage(container);
  };

  window.handleThemeChange = (theme) => {
    setAppTheme(theme);
    renderSettingsPage(container);
  };

  const pwdForm = document.getElementById('password-form');
  if (pwdForm) {
    pwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPwd = document.getElementById('old-password').value;
      const newPwd = document.getElementById('new-password').value;
      const msgEl = document.getElementById('pwd-msg');
      const btn = document.getElementById('pwd-btn');
      
      try {
        btn.disabled = true;
        btn.textContent = '提交中...';
        msgEl.style.display = 'none';
        
        await put('/api/auth/password', { oldPassword: oldPwd, newPassword: newPwd });
        msgEl.style.color = 'var(--color-loss)';
        msgEl.textContent = '修改成功！即将跳转重新登录...';
        msgEl.style.display = 'block';
        
        setTimeout(() => {
          localStorage.removeItem('auth_token');
          window.location.hash = '#/login';
        }, 1500);
      } catch (err) {
        msgEl.style.color = 'var(--color-profit)';
        msgEl.textContent = err.message || '修改失败';
        msgEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = '修改密码';
      }
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('auth_token');
      window.location.hash = '#/login';
    });
  }
}
