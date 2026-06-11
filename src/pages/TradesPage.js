/**
 * StockVault — 交易记录页
 */

import { formatQuantity, getPnLClass } from '../utils/format.js';
import { MARKETS, MARKET_IDS } from '../utils/constants.js';
import { get, put, del } from '../services/api.js';
import { Toast } from '../utils/toast.js';

let currentTrades = [];

/** 货币 → 前缀符号 */
const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', CHF: 'CHF ' };

/** 格式化本币金额 */
function fmtNative(amount, currency, showSign = false) {
  const sym = CURRENCY_SYMBOL[currency] || '';
  const num = Number(amount);
  const absNum = Math.abs(num);
  const formattedAbs = absNum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num < 0) return `-${sym}${formattedAbs}`;
  if (showSign && num > 0) return `+${sym}${formattedAbs}`;
  return `${sym}${formattedAbs}`;
}

export async function renderTradesPage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">交易记录</h2>
        <div class="page-actions">
          <a href="#/trade" class="btn btn--primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            录入交易
          </a>
        </div>
      </div>

      <div class="card mb-4">
        <div class="filter-bar" style="display:flex; gap:16px; margin-bottom:16px; align-items:center; flex-wrap:wrap;">
          <select id="filter-market" class="select" style="width:150px;">
            <option value="">全部市场</option>
            ${MARKET_IDS.map(id => `<option value="${id}">${MARKETS[id].flag} ${MARKETS[id].label}</option>`).join('')}
          </select>
          <select id="filter-type" class="select" style="width:150px;">
            <option value="">全部类型</option>
            <option value="BUY">买入 (BUY)</option>
            <option value="SELL">卖出 (SELL)</option>
          </select>
          <select id="filter-symbol" class="select" style="width:150px;">
            <option value="">全部股票</option>
          </select>
          <button id="btn-search" class="btn btn--ghost">查询</button>
        </div>

        <div class="table-wrapper">
          <table class="table" id="trades-table">
            <thead>
              <tr>
                <th class="table__th">交易日期</th>
                <th class="table__th" style="min-width: 160px;">名称/代码</th>
                <th class="table__th">市场</th>
                <th class="table__th">类型</th>
                <th class="table__th table__th--right">成交价</th>
                <th class="table__th table__th--right">数量</th>
                <th class="table__th table__th--right">总金额</th>
                <th class="table__th table__th--right">手续费</th>
                <th class="table__th table__th--right">实现盈亏</th>
                <th class="table__th table__th--center">操作</th>
              </tr>
            </thead>
            <tbody id="trades-tbody">
              <tr><td colspan="10" class="table__empty">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 修改交易记录 Modal -->
      <div id="edit-trade-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1000; align-items:center; justify-content:center;">
        <div class="card animate-fade-in-up" style="width:400px; max-width:90%;">
          <h3 style="margin-top:0; margin-bottom:16px;">修改交易记录</h3>
          <form id="edit-trade-form">
            <input type="hidden" id="edit-trade-id">
            <div class="form-group">
              <label class="form-label">成交价</label>
              <input type="number" step="0.0001" id="edit-trade-price" class="input" required>
            </div>
            <div class="form-group">
              <label class="form-label">数量</label>
              <input type="number" step="0.001" id="edit-trade-quantity" class="input" required>
            </div>
            <div class="form-group">
              <label class="form-label">手续费</label>
              <input type="number" step="0.01" id="edit-trade-commission" class="input" required>
            </div>
            <div class="form-group">
              <label class="form-label">交易日期</label>
              <input type="date" id="edit-trade-date" class="input" required>
            </div>
            <div class="form-group">
              <label class="form-label">备注</label>
              <textarea id="edit-trade-notes" class="textarea" rows="2"></textarea>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
              <button type="button" id="btn-cancel-edit" class="btn btn--ghost">取消</button>
              <button type="submit" id="btn-save-edit" class="btn btn--primary">保存</button>
            </div>
          </form>
        </div>
      </div>

      <!-- 删除交易记录 Modal -->
      <div id="delete-trade-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1000; align-items:center; justify-content:center;">
        <div class="card animate-fade-in-up" style="width:400px; max-width:90%;">
          <div style="display:flex; justify-content:center; margin-bottom:16px; color:#ef4444;"><i data-lucide="trash-2" style="width: 48px; height: 48px; stroke-width: 1.5;"></i></div>
          <h3 style="margin:0 0 8px;text-align:center;font-size:1.1rem;">确认删除交易记录</h3>
          <p id="delete-trade-msg" style="margin:0 0 24px;text-align:center;color:var(--color-text-secondary,#9ca3af);font-size:0.9rem;">
            是否确认删除该条交易记录？
          </p>
          <div style="display:flex; justify-content:center; gap:12px;">
            <button id="btn-cancel-delete" class="btn btn--ghost">取消</button>
            <button id="btn-confirm-delete" class="btn" style="background:#ef4444;color:#fff;border:none;">确认删除</button>
          </div>
        </div>
      </div>
    </div>
  `;

  await loadSymbols();
  await loadTrades();

  container.querySelector('#trades-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-edit-trade');
    if (!btn) return;
    const id = btn.dataset.id;
    const trade = currentTrades.find(t => t.id === id);
    if (!trade) return;

    document.getElementById('edit-trade-id').value = trade.id;
    document.getElementById('edit-trade-price').value = trade.price;
    document.getElementById('edit-trade-quantity').value = trade.quantity;
    document.getElementById('edit-trade-commission').value = trade.commission || 0;
    document.getElementById('edit-trade-date').value = trade.trade_date;
    document.getElementById('edit-trade-notes').value = trade.notes || '';

    const modal = document.getElementById('edit-trade-modal');
    if (modal) {
      modal.style.display = 'flex';
    }
  });

  container.querySelector('#btn-cancel-edit')?.addEventListener('click', () => {
    document.getElementById('edit-trade-modal').style.display = 'none';
  });

  container.querySelector('#edit-trade-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSave = document.getElementById('btn-save-edit');
    const originalText = btnSave.textContent;
    btnSave.textContent = '保存中...';
    btnSave.disabled = true;

    try {
      const id = document.getElementById('edit-trade-id').value;
      const payload = {
        price: document.getElementById('edit-trade-price').value,
        quantity: document.getElementById('edit-trade-quantity').value,
        commission: document.getElementById('edit-trade-commission').value,
        trade_date: document.getElementById('edit-trade-date').value,
        notes: document.getElementById('edit-trade-notes').value
      };

      await put(`/api/trades/${id}`, payload);
      document.getElementById('edit-trade-modal').style.display = 'none';
      await loadTrades();
      await loadSymbols();
    } catch (err) {
      Toast.error('修改失败: ' + err.message);
    } finally {
      btnSave.textContent = originalText;
      btnSave.disabled = false;
    }
  });

  let deleteTradeId = null;
  container.querySelector('#trades-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-delete-trade');
    if (!btn) return;
    deleteTradeId = btn.dataset.id;
    const tradeType = btn.dataset.type;
    const msgEl = document.getElementById('delete-trade-msg');
    if (tradeType === 'SELL') {
      msgEl.textContent = '此操作会删除该平仓（卖出）记录，相应的持仓数量及成本将会自动恢复，如果已经完全平仓，状态将恢复为持仓中。是否确认删除？';
    } else {
      msgEl.textContent = '是否确认删除该条（买入）交易记录？这将重新计算对应持仓的成本。';
    }
    document.getElementById('delete-trade-modal').style.display = 'flex';
    
    if (window.lucide) {
      window.lucide.createIcons();
    }
  });

  container.querySelector('#btn-cancel-delete')?.addEventListener('click', () => {
    document.getElementById('delete-trade-modal').style.display = 'none';
    deleteTradeId = null;
  });

  container.querySelector('#btn-confirm-delete')?.addEventListener('click', async () => {
    if (!deleteTradeId) return;
    const btnConfirm = document.getElementById('btn-confirm-delete');
    const originalText = btnConfirm.textContent;
    btnConfirm.textContent = '删除中...';
    btnConfirm.disabled = true;

    try {
      await del(`/api/trades/${deleteTradeId}`);
      document.getElementById('delete-trade-modal').style.display = 'none';
      await loadTrades();
      await loadSymbols();
    } catch (err) {
      Toast.error('删除失败: ' + err.message);
    } finally {
      btnConfirm.textContent = originalText;
      btnConfirm.disabled = false;
      deleteTradeId = null;
    }
  });

  container.querySelector('#btn-search')?.addEventListener('click', loadTrades);
}

async function loadSymbols() {
  const selectEl = document.getElementById('filter-symbol');
  if (!selectEl) return;
  const currentVal = selectEl.value;

  let symbols = [];
  let symbolMap = {};
  try {
    const allTrades = await get('/api/trades');
    if (Array.isArray(allTrades)) {
      allTrades.forEach(t => {
        if (t.symbol && !symbolMap[t.symbol]) {
          symbolMap[t.symbol] = t.name || '';
          symbols.push(t.symbol);
        }
      });
      symbols.sort();
    }
  } catch (e) {
    console.error('Failed to load symbols for filter', e);
  }

  selectEl.innerHTML = '<option value="">全部股票</option>' + 
    symbols.map(sym => `<option value="${sym}">${sym}</option>`).join('');
  
  if (symbols.includes(currentVal)) {
    selectEl.value = currentVal;
  }
}

async function loadTrades() {
  const tbody = document.getElementById('trades-tbody');
  if (!tbody) return;

  const market = document.getElementById('filter-market')?.value || '';
  const type = document.getElementById('filter-type')?.value || '';
  const symbol = document.getElementById('filter-symbol')?.value || '';

  tbody.innerHTML = `<tr><td colspan="10" class="table__empty">加载中...</td></tr>`;

  try {
    const params = {};
    if (market) params.market = market;

    // TODO: The backend doesn't support trade_type filter natively yet, but we can filter it client-side for now or implement it.
    // The index.js for trades does not seem to have trade_type in binds. Let's filter client-side for simplicity if it's small, 
    // or just fetch all and filter.
    
    const response = await get('/api/trades', params);
    let trades = Array.isArray(response) ? response : [];
    
    if (type) {
        trades = trades.filter(t => t.trade_type === type);
    }
    if (symbol) {
        trades = trades.filter(t => t.symbol === symbol);
    }

    currentTrades = trades;

    if (trades.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="10" class="table__empty">
          <div class="empty-state">
            <div class="empty-state__icon"><i data-lucide="inbox" style="width: 48px; height: 48px; stroke-width: 1.5;"></i></div>
            <p class="empty-state__text">暂无交易记录</p>
          </div>
        </td></tr>`;
      return;
    }

    tbody.innerHTML = trades.map(trade => {
      const m = MARKETS[trade.market] || {};
      const currency = trade.currency || (m.currency || 'CNY');
      const isBuy = trade.trade_type === 'BUY';
      
      const typeLabel = isBuy ? '买入' : '卖出';
      const typeColor = isBuy ? '#ef4444' : '#10b981'; // Red for buy, Green for sell (common in CN)
      const typeBg = isBuy ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';

      const totalValue = trade.price * trade.quantity;

      let pnlDisplay = '--';
      if (!isBuy && trade.realized_pnl != null) {
        pnlDisplay = `<span class="table__td--${getPnLClass(trade.realized_pnl)}">${fmtNative(trade.realized_pnl, currency, true)}</span>`;
      }

      return `
        <tr class="table__row table__row--hoverable">
          <td class="table__td table__td--mono">${trade.trade_date}</td>
          <td class="table__td">
            <div style="font-weight:600; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${trade.name}">${trade.name}</div>
            <div style="font-size:0.75rem;color:var(--color-text-secondary);font-family:monospace">${trade.symbol}</div>
          </td>
          <td class="table__td" title="${m.label || trade.market}">
            ${m.flag || ''}
          </td>
          <td class="table__td">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:bold;color:${typeColor};background:${typeBg};white-space:nowrap;">
              ${typeLabel}
            </span>
          </td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(trade.price, currency)}</td>
          <td class="table__td table__td--right">${formatQuantity(trade.quantity)}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(totalValue, currency)}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(trade.commission, currency)}</td>
          <td class="table__td table__td--right table__td--mono">${pnlDisplay}</td>
          <td class="table__td table__td--center">
            <div style="display:flex; gap:8px; justify-content:center;">
              <button class="btn btn--ghost btn-edit-trade" data-id="${trade.id}" style="padding: 4px 8px; font-size: 0.75rem;">修改</button>
              <button class="btn btn--ghost btn-delete-trade" data-id="${trade.id}" data-type="${trade.trade_type}" style="padding: 4px 8px; font-size: 0.75rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">删除</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error('Failed to load trades', error);
    tbody.innerHTML = `<tr><td colspan="10" class="table__empty">加载失败: ${error.message}</td></tr>`;
  }
}
