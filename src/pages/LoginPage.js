import { post } from '../services/api.js';

export async function renderLoginPage(container) {
  container.innerHTML = `
    <div class="card animate-fade-in-up" style="width: 100%; max-width: 400px; padding: 40px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 16px;">🔐</div>
      <h2 style="margin-bottom: 8px;">StockVault 登录</h2>
      <p style="color: var(--color-text-secondary); margin-bottom: 32px; font-size: 0.875rem;" id="login-hint">请输入管理员密码</p>
      
      <form id="login-form">
        <div class="form-group" style="text-align: left;">
          <input type="password" id="login-password" class="form-control" placeholder="输入密码" required autofocus />
        </div>
        
        <div id="login-error" style="color: var(--color-profit); font-size: 0.875rem; margin-bottom: 16px; min-height: 20px; display: none;"></div>
        
        <button type="submit" class="btn btn--primary" style="width: 100%; padding: 12px; font-size: 1rem;" id="login-btn">进入系统</button>
      </form>
    </div>
  `;
  
  const form = document.getElementById('login-form');
  const pwdInput = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const hint = document.getElementById('login-hint');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = pwdInput.value.trim();
    if (!password) return;
    
    try {
      btn.textContent = '登录中...';
      btn.disabled = true;
      errorEl.style.display = 'none';
      
      const data = await post('/api/auth/login', { password });
      if (data && data.token) {
        localStorage.setItem('auth_token', data.token);
        if (data.isFirstLogin) {
          alert('这是您的首次登录，刚才输入的密码已设置为初始密码。请牢记！');
        }
        window.location.hash = '#/';
      }
    } catch (err) {
      errorEl.textContent = err.message || '登录失败，请重试';
      errorEl.style.display = 'block';
      pwdInput.focus();
    } finally {
      btn.textContent = '进入系统';
      btn.disabled = false;
    }
  });
}
