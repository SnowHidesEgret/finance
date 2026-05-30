/**
 * StockVault — 持仓管理页
 * 所有金额按持仓本币计价（港股=HKD, 美股=USD, A股=CNY, 瑞士=CHF）
 * 仪表盘汇总才换算人民币
 */

import { formatPercent, formatQuantity, getPnLClass, calcHoldingDays } from '../utils/format.js';
import { MARKETS, MARKET_IDS } from '../utils/constants.js';
import { get, put, del } from '../services/api.js';

/** 货币 → 符号 */
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

/** 根据 market 推断本币（数据库字段 currency 为空时的兜底） */
function getCurrency(pos) {
  if (pos.currency && pos.currency !== '') return pos.currency;
  // fallback by market
  switch (pos.market) {
    case 'US':      return 'USD';
    case 'HK':      return 'HKD';
    case 'SWISS':   return 'CHF';
    case 'A_SHARE': return 'CNY';
    default:        return 'CNY';
  }
}

// ── 删除确认弹窗 ─────────────────────────────────────────────────────────────

function showDeleteModal(pos, onConfirm) {
  // 移除已有弹窗
  document.getElementById('delete-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'delete-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
    display:flex;align-items:center;justify-content:center;z-index:9999;
    animation:fadeIn 0.15s ease;
  `;
  overlay.innerHTML = `
    <div style="
      background:var(--color-surface,#1e1e2e);border:1px solid var(--color-border,#374151);
      border-radius:16px;padding:32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);
    ">
      <div style="display:flex; justify-content:center; margin-bottom:16px; color:#ef4444;"><i data-lucide="trash-2" style="width: 48px; height: 48px; stroke-width: 1.5;"></i></div>
      <h3 style="margin:0 0 8px;text-align:center;font-size:1.1rem;">确认删除持仓</h3>
      <p style="margin:0 0 24px;text-align:center;color:var(--color-text-secondary,#9ca3af);font-size:0.9rem;">
        将永久删除 <strong style="color:var(--color-text-primary)">${pos.name}</strong>（${pos.symbol}）的持仓记录，此操作不可撤销。
      </p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="delete-cancel" class="btn btn--ghost" style="min-width:100px;">取消</button>
        <button id="delete-confirm" class="btn" style="min-width:100px;background:#ef4444;color:#fff;border:none;">确认删除</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#delete-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#delete-confirm').addEventListener('click', async () => {
    const btn = overlay.querySelector('#delete-confirm');
    btn.disabled = true;
    btn.textContent = '删除中...';
    await onConfirm();
    overlay.remove();
  });
}

// ── 平仓确认弹窗 ─────────────────────────────────────────────────────────────

function showCloseModal(pos, currentPrice, currency, onConfirm) {
  document.getElementById('close-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'close-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
    display:flex;align-items:center;justify-content:center;z-index:9999;
    animation:fadeIn 0.15s ease;
  `;
  
  const today = new Date().toISOString().split('T')[0];

  overlay.innerHTML = `
    <div style="
      background:var(--color-surface,#1e1e2e);border:1px solid var(--color-border,#374151);
      border-radius:16px;padding:32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);
    ">
      <div style="display:flex; justify-content:center; margin-bottom:16px; color:#f59e0b;"><i data-lucide="x-octagon" style="width: 48px; height: 48px; stroke-width: 1.5;"></i></div>
      <h3 style="margin:0 0 8px;text-align:center;font-size:1.1rem;">平仓确认</h3>
      <p style="margin:0 0 24px;text-align:center;color:var(--color-text-secondary,#9ca3af);font-size:0.9rem;">
        卖出 <strong style="color:var(--color-text-primary)">${pos.name}</strong>（${pos.symbol}）
      </p>
      
      <div style="margin-bottom: 16px;">
        <label style="display:block;margin-bottom:8px;font-size:0.85rem;color:var(--color-text-secondary);">平仓日期</label>
        <input type="date" id="close-date" class="input" value="${today}" style="width:100%;">
      </div>
      
      <div style="margin-bottom: 16px;">
        <label style="display:block;margin-bottom:8px;font-size:0.85rem;color:var(--color-text-secondary);">平仓数量 (最多 ${pos.quantity})</label>
        <input type="number" id="close-quantity" class="input" value="${pos.quantity}" step="any" min="0.0001" max="${pos.quantity}" style="width:100%;">
      </div>
      
      <div style="margin-bottom: 16px;">
        <label style="display:block;margin-bottom:8px;font-size:0.85rem;color:var(--color-text-secondary);">平仓价格 (${currency})</label>
        <input type="number" id="close-price" class="input" value="${currentPrice || ''}" step="0.001" min="0" style="width:100%;">
      </div>
      
      <div style="margin-bottom: 24px;">
        <label style="display:block;margin-bottom:8px;font-size:0.85rem;color:var(--color-text-secondary);">平仓手续费 (${currency})</label>
        <input type="number" id="close-commission" class="input" value="0" step="0.01" min="0" style="width:100%;">
      </div>

      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="close-cancel" class="btn btn--ghost" style="min-width:100px;">取消</button>
        <button id="close-confirm" class="btn btn--primary" style="min-width:100px;">确认平仓</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#close-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  
  overlay.querySelector('#close-confirm').addEventListener('click', async () => {
    const dateInput = overlay.querySelector('#close-date').value;
    const priceInput = overlay.querySelector('#close-price').value;
    const commissionInput = overlay.querySelector('#close-commission').value;
    const quantityInput = overlay.querySelector('#close-quantity').value;

    if (!dateInput || !priceInput || !quantityInput) {
      alert('请输入平仓日期、价格和数量');
      return;
    }
    
    if (parseFloat(quantityInput) > pos.quantity) {
      alert(`平仓数量不能超过持仓总量 (${pos.quantity})`);
      return;
    }

    const btn = overlay.querySelector('#close-confirm');
    btn.disabled = true;
    btn.textContent = '处理中...';
    
    await onConfirm({
      close_date: dateInput,
      close_price: parseFloat(priceInput),
      close_commission: parseFloat(commissionInput) || 0,
      close_quantity: parseFloat(quantityInput)
    });
    
    overlay.remove();
  });
}

// ── 逐笔明细弹窗 ─────────────────────────────────────────────────────────────

function showActiveLotsModal(pos, currency, activeLots) {
  document.getElementById('active-lots-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'active-lots-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
    display:flex;align-items:center;justify-content:center;z-index:9999;
    animation:fadeIn 0.15s ease;
  `;
  
  const lotsHtml = activeLots && activeLots.length > 0 ? activeLots.map(lot => `
    <tr class="table__row">
      <td class="table__td">${lot.trade_date}</td>
      <td class="table__td table__td--right">${formatQuantity(lot.activeQuantity)}</td>
      <td class="table__td table__td--right table__td--mono">${fmtNative(lot.price, currency)}</td>
      <td class="table__td table__td--right table__td--mono">${fmtNative(lot.costNative, currency)}</td>
      <td class="table__td table__td--right table__td--mono table__td--${getPnLClass(lot.pnlNative)}">${fmtNative(lot.pnlNative, currency, true)}</td>
      <td class="table__td table__td--right table__td--${getPnLClass(lot.pnlPercent)}">${formatPercent(lot.pnlPercent)}</td>
      <td class="table__td table__td--right">${lot.holdingDays}天</td>
      <td class="table__td table__td--right table__td--${getPnLClass(lot.annualizedReturn)}">${formatPercent(lot.annualizedReturn)}</td>
    </tr>
  `).join('') : `<tr><td colspan="8" class="table__empty">暂无未平仓批次数据</td></tr>`;

  overlay.innerHTML = `
    <div style="
      background:var(--color-surface,#1e1e2e);border:1px solid var(--color-border,#374151);
      border-radius:16px;padding:32px;max-width:900px;width:95%;box-shadow:0 20px 60px rgba(0,0,0,0.5);
      max-height: 90vh; display: flex; flex-direction: column;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
        <h3 style="margin:0;font-size:1.25rem;color:var(--color-text-primary);"><span style="color:var(--color-primary);">${pos.name}</span> 逐笔未平仓明细</h3>
        <button id="lots-close" class="btn btn--ghost" style="padding:8px;"><i data-lucide="x" style="width: 24px; height: 24px;"></i></button>
      </div>
      
      <div class="table-wrapper" style="flex:1; overflow-y:auto; border:1px solid var(--color-border); border-radius:8px;">
        <table class="table" style="margin:0;">
          <thead style="position:sticky;top:0;background:var(--color-surface);z-index:1;">
            <tr>
              <th class="table__th">交易日期</th>
              <th class="table__th table__th--right">剩余数量</th>
              <th class="table__th table__th--right">成本均价</th>
              <th class="table__th table__th--right">持有成本</th>
              <th class="table__th table__th--right">浮动盈亏</th>
              <th class="table__th table__th--right">盈亏比例</th>
              <th class="table__th table__th--right">持仓天数</th>
              <th class="table__th table__th--right">年化收益率</th>
            </tr>
          </thead>
          <tbody>
            ${lotsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#lots-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ── 页面渲染 ──────────────────────────────────────────────────────────────────

export async function renderPositionsPage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">持仓管理</h2>
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
        <div class="filter-bar" style="display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap;">
          <select id="filter-market" class="select" style="width:140px;">
            <option value="">全部市场</option>
            ${MARKET_IDS.map(id => `<option value="${id}">${MARKETS[id].flag} ${MARKETS[id].label}</option>`).join('')}
          </select>
          <select id="filter-status" class="select" style="width:130px;">
            <option value="OPEN">持仓中</option>
            <option value="CLOSED">已平仓</option>
            <option value="">全部</option>
          </select>
          <button id="btn-search" class="btn btn--ghost">查询</button>
          <span id="price-update-time" style="margin-left:auto;font-size:0.75rem;color:var(--color-text-muted)"></span>
        </div>

        <div class="table-wrapper">
          <table class="table" id="full-positions-table">
            <thead>
              <tr>
                <th class="table__th">名称/代码</th>
                <th class="table__th">市场</th>
                <th class="table__th table__th--right">数量</th>
                <th class="table__th table__th--right">开仓均价</th>
                <th class="table__th table__th--right">现价</th>
                <th class="table__th table__th--right">总成本</th>
                <th class="table__th table__th--right">当前市值</th>
                <th class="table__th table__th--right">浮动盈亏</th>
                <th class="table__th table__th--right">收益率</th>
                <th class="table__th table__th--right">持仓天数</th>
                <th class="table__th table__th--right">年化收益</th>
                <th class="table__th table__th--right">状态</th>
                <th class="table__th table__th--right">操作</th>
              </tr>
            </thead>
            <tbody id="full-positions-tbody">
              <tr><td colspan="13" class="table__empty">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  await loadPositions();

  container.querySelector('#btn-search')?.addEventListener('click', loadPositions);

  // 全局刷新监听
  const refreshHandler = () => loadPositions();
  window.addEventListener('stockvault:refresh', refreshHandler);
  const observer = new MutationObserver(() => {
    if (!document.getElementById('full-positions-table')) {
      window.removeEventListener('stockvault:refresh', refreshHandler);
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });
}

// ── 数据加载 ──────────────────────────────────────────────────────────────────

async function loadPositions() {
  const tbody = document.getElementById('full-positions-tbody');
  if (!tbody) return;

  const market = document.getElementById('filter-market')?.value || '';
  const status = document.getElementById('filter-status')?.value || 'OPEN';

  tbody.innerHTML = `<tr><td colspan="13" class="table__empty">加载中...</td></tr>`;

  try {
    const params = {};
    if (market) params.market = market;
    if (status) params.status = status;

    // 并行获取：持仓列表 + 含实时价格的 summary
    const [rawPositions, summary] = await Promise.all([
      get('/api/positions', params),
      get('/api/summary').catch(() => null),
    ]);

    const positions = Array.isArray(rawPositions) ? rawPositions : [];

    if (positions.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="13" class="table__empty">
          <div class="empty-state">
            <div class="empty-state__icon"><i data-lucide="inbox" style="width: 48px; height: 48px; stroke-width: 1.5;"></i></div>
            <p class="empty-state__text">暂无数据</p>
            <a href="#/trade" class="btn btn--primary btn--sm">录入第一笔交易</a>
          </div>
        </td></tr>`;
      return;
    }

    // 实时价格 map: symbol → liveData（来自 summary API）
    const liveMap = new Map();
    if (summary?.positions) {
      for (const p of summary.positions) {
        liveMap.set(p.symbol?.toUpperCase(), p);
      }
    }

    // 行情时间戳
    const timeEl = document.getElementById('price-update-time');
    if (timeEl) {
      const anyLive = [...liveMap.values()].some(p => p.hasLivePrice);
      timeEl.textContent = anyLive
        ? `⏱ 行情: ${new Date().toLocaleTimeString('zh-CN')}`
        : '⚠ 行情获取失败，显示成本价';
      timeEl.style.color = anyLive ? 'var(--color-text-muted)' : '#f59e0b';
    }

    tbody.innerHTML = positions.map(pos => {
      const isClosed = pos.status === 'CLOSED';
      const m = MARKETS[pos.market] || {};

      // ── 本币（优先用 DB 存储的 currency，为空则按市场推断）
      const currency = getCurrency(pos);
      const sym      = CURRENCY_SYMBOL[currency] || '';
      const live     = liveMap.get(pos.symbol?.toUpperCase());

      // 现价（本币）
      const currentPrice = isClosed
        ? (pos.close_price ?? pos.open_price)
        : (live?.currentPrice ?? pos.open_price);
      const hasLivePrice = !isClosed && !!live?.hasLivePrice;

      // 成本 / 市值 / 盈亏（全部本币，不做汇率换算）
      const costOrig  = pos.open_price * pos.quantity + (pos.commission ?? 0);
      const valueOrig = currentPrice * pos.quantity;
      const pnlOrig   = valueOrig - costOrig;
      const pnlPct    = costOrig > 0 ? (pnlOrig / costOrig) * 100 : 0;

      // 持仓天数与年化收益率
      let holdingDays, annualizedRtn;
      if (isClosed) {
        holdingDays = calcHoldingDays(pos.open_date, pos.close_date);
        annualizedRtn = holdingDays > 0 ? (pnlPct / holdingDays) * 365 : 0;
      } else {
        holdingDays = live?.holdingDays || calcHoldingDays(pos.open_date);
        annualizedRtn = live?.annualizedReturn ?? (holdingDays > 0 ? (pnlPct / holdingDays) * 365 : 0);
      }

      const priceDisplay = hasLivePrice
        ? fmtNative(currentPrice, currency)
        : `<span style="color:var(--color-text-muted)" title="未获取到实时行情，显示开仓价">${fmtNative(currentPrice, currency)} <small>*</small></span>`;

      return `
        <tr class="table__row table__row--hoverable" data-id="${pos.id}">
          <td class="table__td">
            <div class="pos-name-click" style="font-weight:600; cursor:pointer; color:var(--color-primary); display:inline-block; border-bottom:1px dashed var(--color-primary);" data-id="${pos.id}" data-symbol="${pos.symbol}" data-name="${pos.name}" data-currency="${currency}" title="点击查看逐笔未平仓明细">${pos.name}</div>
            <div style="font-size:0.75rem;color:var(--color-text-secondary);font-family:monospace">${pos.symbol}</div>
          </td>
          <td class="table__td" title="${m.label || pos.market}">
            ${m.flag || ''}
          </td>
          <td class="table__td table__td--right">${formatQuantity(pos.quantity)}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(pos.open_price, currency)}</td>
          <td class="table__td table__td--right table__td--mono">${priceDisplay}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(costOrig, currency)}</td>
          <td class="table__td table__td--right table__td--mono">${fmtNative(valueOrig, currency)}</td>
          <td class="table__td table__td--right table__td--mono table__td--${getPnLClass(pnlOrig)}">
            ${fmtNative(pnlOrig, currency, true)}
          </td>
          <td class="table__td table__td--right table__td--${getPnLClass(pnlPct)}">
            ${formatPercent(pnlPct)}
          </td>
          <td class="table__td table__td--right table__td--mono" title="持仓天数">
            ${holdingDays}天
          </td>
          <td class="table__td table__td--right table__td--${getPnLClass(annualizedRtn)}">
            ${formatPercent(annualizedRtn)}
          </td>
          <td class="table__td table__td--right">
            <span class="tag" style="background:${isClosed ? '#374151' : '#065f46'}">
              ${isClosed ? '已平仓' : '持仓中'}
            </span>
          </td>
          <td class="table__td table__td--right">
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              ${!isClosed ? `
              <button class="btn btn--sm btn--ghost btn-close-pos"
                data-id="${pos.id}" data-name="${pos.name}" data-symbol="${pos.symbol}" data-quantity="${pos.quantity}" data-price="${currentPrice}" data-currency="${currency}"
                title="平仓">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              </button>` : ''}
              <button class="btn btn--sm btn--ghost btn-delete-pos"
                data-id="${pos.id}" data-name="${pos.name}" data-symbol="${pos.symbol}"
                style="color:#ef4444;border-color:rgba(239,68,68,0.3);"
                title="删除持仓">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6l-1 14H6L5 6"></path>
                  <path d="M10 11v6M14 11v6"></path>
                  <path d="M9 6V4h6v2"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // 绑定查看逐笔明细事件
    tbody.querySelectorAll('.pos-name-click').forEach(btn => {
      btn.addEventListener('click', () => {
        const { id, symbol, name, currency } = btn.dataset;
        const live = liveMap.get(symbol.toUpperCase());
        if (live && live.activeLots && live.activeLots.length > 0) {
          showActiveLotsModal({ id, name, symbol }, currency, live.activeLots);
        } else {
          alert('暂无该股票的未平仓逐笔明细数据（仅在持有仓位时显示）。');
        }
      });
    });

    // 绑定删除按钮事件
    tbody.querySelectorAll('.btn-delete-pos').forEach(btn => {
      btn.addEventListener('click', () => {
        const { id, name, symbol } = btn.dataset;
        showDeleteModal({ id, name, symbol }, async () => {
          try {
            await del(`/api/positions/${id}`);
            await loadPositions(); // 刷新列表
          } catch (err) {
            alert(`删除失败: ${err.message}`);
          }
        });
      });
    });

    // 绑定平仓按钮事件
    tbody.querySelectorAll('.btn-close-pos').forEach(btn => {
      btn.addEventListener('click', () => {
        const { id, name, symbol, quantity, price, currency } = btn.dataset;
        showCloseModal({ id, name, symbol, quantity }, price, currency, async (closeData) => {
          try {
            await put(`/api/positions/${id}`, {
              status: 'CLOSED',
              ...closeData
            });
            await loadPositions(); // 刷新列表
          } catch (err) {
            alert(`平仓失败: ${err.message}`);
          }
        });
      });
    });

  } catch (error) {
    console.error('Failed to load positions', error);
    tbody.innerHTML = `<tr><td colspan="11" class="table__empty">加载失败: ${error.message}</td></tr>`;
  }
}
