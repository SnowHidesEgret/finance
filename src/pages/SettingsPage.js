/**
 * StockVault — 设置页
 */
import { get, put, post, del } from '../services/api.js';
import { getColorScheme, setColorScheme } from '../utils/colorScheme.js';
import { getAppTheme, setAppTheme } from '../utils/appTheme.js';
import { getFontSize, setFontSize } from '../utils/fontSize.js';
import { COLOR_SCHEMES } from '../utils/constants.js';

export async function renderSettingsPage(container) {
  const currentScheme = getColorScheme();
  const currentTheme = getAppTheme();
  const currentFontSize = getFontSize();
  
  let apiSettings = { finnhub_api_key: '', alpha_vantage_api_key: '' };
  let apiKeyStatus = { configured: false, createdAt: null };
  try {
    apiSettings = await get('/api/settings');
  } catch (err) {
    console.error('[Settings] Failed to fetch API settings:', err);
  }
  try {
    apiKeyStatus = await get('/api/settings/apikey');
  } catch (err) {
    console.error('[Settings] Failed to fetch API Key status:', err);
  }
  
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

        <div class="form-group" style="margin-bottom:24px;">
          <label class="form-label" style="font-size:1rem; font-weight:600; color:var(--color-text-primary)">字体大小</label>
          <p style="font-size:0.875rem; color:var(--color-text-secondary); margin-bottom:12px;">调整全局字体大小，以获得更好的阅读体验。</p>
          
          <div style="display:flex; gap:16px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid ${currentFontSize === 'small' ? 'var(--color-accent)' : 'transparent'}">
              <input type="radio" name="font_size" value="small" ${currentFontSize === 'small' ? 'checked' : ''} onchange="window.handleFontSizeChange('small')">
              <div style="font-weight:500;">小 (14px)</div>
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid ${currentFontSize === 'medium' ? 'var(--color-accent)' : 'transparent'}">
              <input type="radio" name="font_size" value="medium" ${currentFontSize === 'medium' ? 'checked' : ''} onchange="window.handleFontSizeChange('medium')">
              <div style="font-weight:500;">中 (16px)</div>
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid ${currentFontSize === 'large' ? 'var(--color-accent)' : 'transparent'}">
              <input type="radio" name="font_size" value="large" ${currentFontSize === 'large' ? 'checked' : ''} onchange="window.handleFontSizeChange('large')">
              <div style="font-weight:500;">大 (18px)</div>
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid ${currentFontSize === 'xlarge' ? 'var(--color-accent)' : 'transparent'}">
              <input type="radio" name="font_size" value="xlarge" ${currentFontSize === 'xlarge' ? 'checked' : ''} onchange="window.handleFontSizeChange('xlarge')">
              <div style="font-weight:500;">超大 (20px)</div>
            </label>
          </div>
        </div>

      </div>

      <div class="card" style="max-width: 600px; margin-top: 24px;">
        <h3 style="margin-bottom:24px; font-size:1.1rem; border-bottom:1px solid var(--color-border); padding-bottom:12px;">第三方 API 密钥配置</h3>
        <form id="api-settings-form">
          <div class="form-group" style="margin-bottom:16px;">
            <label class="form-label" style="font-size:0.875rem; color:var(--color-text-secondary)">Finnhub API Key</label>
            <input type="password" id="finnhub-api-key" class="input" placeholder="输入 Finnhub API 密钥" value="${apiSettings.finnhub_api_key || ''}">
            <p style="font-size:0.75rem; color:var(--color-text-muted); margin-top:4px;">用于获取海外股票/ETF及指数的辅助实时行情。</p>
          </div>
          <div class="form-group" style="margin-bottom:16px;">
            <label class="form-label" style="font-size:0.875rem; color:var(--color-text-secondary)">Alpha Vantage API Key</label>
            <input type="password" id="alpha-vantage-api-key" class="input" placeholder="输入 Alpha Vantage API 密钥" value="${apiSettings.alpha_vantage_api_key || ''}">
            <p style="font-size:0.75rem; color:var(--color-text-muted); margin-top:4px;">用于查询外汇、大宗商品（如现货黄金）等多元资产数据。</p>
          </div>
          <div id="api-msg" style="font-size:0.875rem; margin-bottom:16px; display:none;"></div>
          <button type="submit" class="btn btn--primary" id="api-btn">保存 API 设置</button>
        </form>
      </div>

      <div class="card" style="max-width: 600px; margin-top: 24px;">
        <h3 style="margin-bottom:24px; font-size:1.1rem; border-bottom:1px solid var(--color-border); padding-bottom:12px;">🔑 Agent API 密钥</h3>
        <p style="font-size:0.875rem; color:var(--color-text-secondary); margin-bottom:16px;">
          为外部 AI 智能体生成专用 API Key，用于安全访问您的投资数据。密钥仅在生成时显示一次，请妥善保管。
        </p>

        <div id="apikey-status" style="margin-bottom:16px; padding:12px 16px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid var(--color-border);">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="width:8px; height:8px; border-radius:50%; background:${apiKeyStatus.configured ? '#10b981' : '#6b7280'}; display:inline-block;"></span>
              <span style="font-size:0.875rem; color:var(--color-text-primary);">
                ${apiKeyStatus.configured ? '已配置' : '未配置'}
              </span>
            </div>
            ${apiKeyStatus.configured && apiKeyStatus.createdAt ? `<span style="font-size:0.75rem; color:var(--color-text-muted);">创建于 ${new Date(apiKeyStatus.createdAt).toLocaleDateString('zh-CN')}</span>` : ''}
          </div>
        </div>

        <div id="apikey-result" style="display:none; margin-bottom:16px; padding:12px 16px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:8px;">
          <p style="font-size:0.75rem; color:#10b981; margin-bottom:8px; font-weight:600;">⚠️ 请立即复制并保存此密钥，它只会显示一次！</p>
          <div style="display:flex; align-items:center; gap:8px;">
            <code id="apikey-value" style="flex:1; font-size:0.8rem; padding:8px 12px; background:rgba(0,0,0,0.3); border-radius:4px; word-break:break-all; color:var(--color-text-primary); font-family:monospace;"></code>
            <button type="button" id="apikey-copy-btn" class="btn" style="padding:6px 12px; font-size:0.75rem; white-space:nowrap;">复制</button>
          </div>
        </div>

        <div id="apikey-msg" style="font-size:0.875rem; margin-bottom:16px; display:none;"></div>

        <div style="display:flex; gap:12px;">
          <button type="button" id="apikey-generate-btn" class="btn btn--primary" style="font-size:0.875rem;">
            ${apiKeyStatus.configured ? '🔄 重新生成' : '✨ 生成密钥'}
          </button>
          ${apiKeyStatus.configured ? '<button type="button" id="apikey-revoke-btn" class="btn" style="font-size:0.875rem; background:transparent; border:1px solid var(--color-loss); color:var(--color-loss);">🗑️ 撤销密钥</button>' : ''}
        </div>

        <div style="margin-top:16px; padding:12px 16px; background:rgba(255,255,255,0.02); border-radius:8px; border:1px dashed var(--color-border);">
          <p style="font-size:0.75rem; color:var(--color-text-muted); margin-bottom:6px; font-weight:600;">📡 API 使用方式</p>
          <code style="font-size:0.7rem; color:var(--color-text-secondary); display:block; font-family:monospace; line-height:1.8;">
            curl -H "Authorization: Bearer sk-xxxxx" \\<br>
            &nbsp;&nbsp;${window.location.origin}/api/agent/portfolio<br>
            <span style="color:var(--color-text-muted);"># 或使用 sv 命令行工具：</span><br>
            export STOCKVAULT_API_KEY=sk-xxxxx && npx stockvault-cli portfolio
          </code>
          <div style="border-top: 1px dashed var(--color-border); padding-top: 8px; margin-top: 8px;">
            <a href="/SKILL.md" download="SKILL.md" style="font-size:0.75rem; color:var(--color-accent); text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-weight: 500; transition: opacity 0.2s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">
              💾 下载 Agent SKILL.md 技能配置文件
            </a>
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
          <div class="form-group" style="margin-bottom:16px;">
            <label class="form-label" style="font-size:0.875rem; color:var(--color-text-secondary)">确认新密码</label>
            <input type="password" id="confirm-password" class="form-control" placeholder="再次输入新密码" required>
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

  window.handleFontSizeChange = (size) => {
    setFontSize(size);
    renderSettingsPage(container);
  };

  const pwdForm = document.getElementById('password-form');
  if (pwdForm) {
    pwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPwd = document.getElementById('old-password').value;
      const newPwd = document.getElementById('new-password').value;
      const confirmPwd = document.getElementById('confirm-password').value;
      const msgEl = document.getElementById('pwd-msg');
      const btn = document.getElementById('pwd-btn');
      
      if (newPwd !== confirmPwd) {
        msgEl.style.color = 'var(--color-profit)';
        msgEl.textContent = '两次输入的新密码不一致，请重新检查';
        msgEl.style.display = 'block';
        return;
      }
      
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

  const apiForm = document.getElementById('api-settings-form');
  if (apiForm) {
    apiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const finnhubKey = document.getElementById('finnhub-api-key').value.trim();
      const alphaVantageKey = document.getElementById('alpha-vantage-api-key').value.trim();
      const msgEl = document.getElementById('api-msg');
      const btn = document.getElementById('api-btn');
      
      try {
        btn.disabled = true;
        btn.textContent = '保存中...';
        msgEl.style.display = 'none';
        
        await put('/api/settings', {
          finnhub_api_key: finnhubKey,
          alpha_vantage_api_key: alphaVantageKey
        });
        
        msgEl.style.color = 'var(--color-loss)';
        msgEl.textContent = 'API 密钥保存成功！';
        msgEl.style.display = 'block';
        
        setTimeout(() => {
          msgEl.style.display = 'none';
        }, 3000);
      } catch (err) {
        msgEl.style.color = 'var(--color-profit)';
        msgEl.textContent = err.message || '保存失败';
        msgEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = '保存 API 设置';
      }
    });
  }

  // ── Agent API Key management ─────────────────────────────────────
  const generateBtn = document.getElementById('apikey-generate-btn');
  if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
      const msgEl = document.getElementById('apikey-msg');
      const resultEl = document.getElementById('apikey-result');
      const valueEl = document.getElementById('apikey-value');

      if (apiKeyStatus.configured) {
        if (!confirm('重新生成将使当前密钥失效，确定继续吗？')) return;
      }

      try {
        generateBtn.disabled = true;
        generateBtn.textContent = '生成中...';
        msgEl.style.display = 'none';

        const result = await post('/api/settings/apikey', {});
        valueEl.textContent = result.apiKey;
        resultEl.style.display = 'block';

        // Update status indicator
        const statusDot = document.querySelector('#apikey-status span:first-child');
        const statusText = document.querySelector('#apikey-status span:nth-child(2)');
        if (statusDot) statusDot.style.background = '#10b981';
        if (statusText) statusText.textContent = '已配置';

        generateBtn.textContent = '🔄 重新生成';
        apiKeyStatus.configured = true;
      } catch (err) {
        msgEl.style.color = 'var(--color-loss)';
        msgEl.textContent = err.message || '生成失败';
        msgEl.style.display = 'block';
      } finally {
        generateBtn.disabled = false;
        if (!generateBtn.textContent.startsWith('🔄')) {
          generateBtn.textContent = apiKeyStatus.configured ? '🔄 重新生成' : '✨ 生成密钥';
        }
      }
    });
  }

  const copyBtn = document.getElementById('apikey-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const valueEl = document.getElementById('apikey-value');
      if (valueEl && valueEl.textContent) {
        navigator.clipboard.writeText(valueEl.textContent).then(() => {
          copyBtn.textContent = '已复制 ✓';
          setTimeout(() => { copyBtn.textContent = '复制'; }, 2000);
        });
      }
    });
  }

  const revokeBtn = document.getElementById('apikey-revoke-btn');
  if (revokeBtn) {
    revokeBtn.addEventListener('click', async () => {
      if (!confirm('撤销后所有使用此密钥的智能体将无法访问，确定吗？')) return;
      const msgEl = document.getElementById('apikey-msg');

      try {
        revokeBtn.disabled = true;
        revokeBtn.textContent = '撤销中...';
        await del('/api/settings/apikey');

        msgEl.style.color = '#10b981';
        msgEl.textContent = 'API Key 已成功撤销';
        msgEl.style.display = 'block';

        // Re-render after brief delay
        setTimeout(() => renderSettingsPage(container), 1000);
      } catch (err) {
        msgEl.style.color = 'var(--color-loss)';
        msgEl.textContent = err.message || '撤销失败';
        msgEl.style.display = 'block';
        revokeBtn.disabled = false;
        revokeBtn.textContent = '🗑️ 撤销密钥';
      }
    });
  }
}
