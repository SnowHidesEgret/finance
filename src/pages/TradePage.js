/**
 * StockVault — 交易录入页
 */
import { MARKETS, MARKET_IDS, SECTORS } from '../utils/constants.js';
import { post } from '../services/api.js';
import { navigate } from '../router/index.js';

export async function renderTradePage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up" style="max-width: 800px;">
      <div class="page-header">
        <h2 class="page-title">录入新交易 (开仓)</h2>
      </div>
      
      <div class="card">
        <form id="trade-form">
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">股票代码</label>
              <input type="text" class="input" id="f-symbol" required placeholder="如 AAPL, 0700.HKG, 600519.SHH">
            </div>
            <div class="form-group">
              <label class="form-label">股票名称</label>
              <input type="text" class="input" id="f-name" required placeholder="如 苹果, 腾讯控股, 贵州茅台">
            </div>
          </div>
          
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">交易市场</label>
              <select class="select" id="f-market" required>
                <option value="">请选择市场</option>
                ${MARKET_IDS.map(id => `<option value="${id}">${MARKETS[id].label} (${MARKETS[id].currency})</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">所属行业 (可选)</label>
              <select class="select" id="f-sector">
                <option value="">未分类</option>
                ${Object.entries(SECTORS).map(([k,v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
              </select>
            </div>
          </div>
          
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">买入均价</label>
              <input type="number" step="0.001" class="input" id="f-price" required>
            </div>
            <div class="form-group">
              <label class="form-label">买入数量</label>
              <input type="number" step="1" class="input" id="f-quantity" required>
            </div>
          </div>
          
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">交易日期</label>
              <input type="date" class="input" id="f-date" required value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
              <label class="form-label">手续费</label>
              <input type="number" step="0.01" class="input" id="f-commission" value="0">
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">备注 (可选)</label>
            <textarea class="textarea" id="f-notes" rows="3"></textarea>
          </div>
          
          <div style="margin-top:24px; display:flex; justify-content:flex-end; gap:16px;">
            <button type="button" class="btn btn--ghost" onclick="window.history.back()">取消</button>
            <button type="submit" class="btn btn--primary" id="btn-submit-trade">保存并建仓</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  const form = container.querySelector('#trade-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-trade');
    btn.disabled = true;
    btn.textContent = '保存中...';
    
    try {
      const data = {
        symbol: document.getElementById('f-symbol').value,
        name: document.getElementById('f-name').value,
        market: document.getElementById('f-market').value,
        sector: document.getElementById('f-sector').value,
        open_price: parseFloat(document.getElementById('f-price').value),
        quantity: parseFloat(document.getElementById('f-quantity').value),
        open_date: document.getElementById('f-date').value,
        commission: parseFloat(document.getElementById('f-commission').value) || 0,
        notes: document.getElementById('f-notes').value
      };
      
      await post('/api/positions', data);
      alert('建仓成功！');
      navigate('/positions');
    } catch (err) {
      alert('保存失败: ' + err.message);
      btn.disabled = false;
      btn.textContent = '保存并建仓';
    }
  });
}
