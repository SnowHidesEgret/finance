import { post } from '../services/api.js';

export async function renderLoginPage(container) {
  container.innerHTML = `
    <div style="
      position: fixed; inset: 0; 
      background: url('./assets/alibaba_cave.png') center/cover no-repeat;
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
    ">
      <div class="card animate-fade-in-up" style="
        width: 100%; max-width: 440px; padding: 48px 40px; text-align: center;
        background: rgba(17, 24, 39, 0.75);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      ">
        <div style="font-size: 64px; margin-bottom: 16px; text-shadow: 0 0 20px rgba(250, 204, 21, 0.5);">✨</div>
        <h2 style="margin-bottom: 12px; font-size: 2.25rem; font-weight: 700; background: linear-gradient(to right, #fbbf24, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">混乱是阶梯</h2>
        <p style="color: rgba(255, 255, 255, 0.9); margin-bottom: 32px; font-size: 1.25rem;" id="login-hint">芝麻开门：请输入开启宝库的密语</p>
        
        <form id="login-form">
          <div class="form-group" style="text-align: left;">
            <input type="password" id="login-password" class="form-control" placeholder="输入密语..." required autofocus style="
              background: rgba(0, 0, 0, 0.6);
              border: 1px solid rgba(255, 255, 255, 0.2);
              font-size: 1.25rem;
              padding: 16px;
              color: #fff;
              border-radius: 12px;
            "/>
          </div>
          
          <div id="login-error" style="color: #ef4444; font-size: 1.125rem; margin-bottom: 16px; min-height: 24px; display: none; text-shadow: 0 2px 4px rgba(0,0,0,0.8);"></div>
          
          <button type="submit" class="btn btn--primary" style="
            width: 100%; padding: 16px; font-size: 1.25rem; font-weight: 600;
            background: linear-gradient(135deg, #f59e0b, #d97706);
            border: none;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);
            color: #fff;
          " id="login-btn">进入宝库</button>
        </form>
      </div>
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
