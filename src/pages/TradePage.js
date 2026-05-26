/**
 * StockVault — 交易录入页（含股票代码自动匹配）
 */
import { MARKETS, MARKET_IDS, SECTORS } from '../utils/constants.js';
import { post } from '../services/api.js';
import { searchStock } from '../services/stockApi.js';
import { navigate } from '../router/index.js';
import { getExchangeRates } from '../services/exchangeRate.js';

/**
 * Yahoo Finance exchDisp/region → 内部 market ID 映射
 */
const REGION_TO_MARKET = {
  'united states':  'US',
  'hong kong':      'HK',
  'frankfurt':      'US',     // fallback
  'london':         'US',     // fallback
  'nasdaq':         'US',
  'nyse':           'US',
  'otc':            'US',
  'otc markets':    'US',
  // 中国大陆交易所
  'shanghai':       'A_SHARE',
  'shenzhen':       'A_SHARE',
  'china':          'A_SHARE',
  // 瑞士
  'switzerland':    'SWISS',
  'zurich':         'SWISS',
  'swiss':          'SWISS',
};

/**
 * 根据 Yahoo Finance 的 exchDisp 或 region 字段推断内部市场 ID
 * @param {string} region
 * @param {string} symbol
 * @returns {string} market ID
 */
function inferMarket(region, symbol) {
  if (!region) return '';
  const key = region.toLowerCase().trim();

  // 直接匹配
  if (REGION_TO_MARKET[key]) return REGION_TO_MARKET[key];

  // 模糊匹配
  for (const [pattern, market] of Object.entries(REGION_TO_MARKET)) {
    if (key.includes(pattern)) return market;
  }

  // 通过 symbol 后缀推断
  const sym = (symbol || '').toUpperCase();
  if (sym.endsWith('.SHH') || sym.endsWith('.SHZ')) return 'A_SHARE';
  if (sym.endsWith('.HKG')) return 'HK';
  if (sym.endsWith('.SWX')) return 'SWISS';

  return '';
}

export async function renderTradePage(container) {
  container.innerHTML = `
    <div class="page-container animate-fade-in-up" style="max-width: 800px;">
      <div class="page-header">
        <h2 class="page-title">录入新交易 (开仓)</h2>
      </div>
      
      <div class="card">
        <form id="trade-form">
          <div class="grid-2">
            <div class="form-group autocomplete">
              <label class="form-label">股票代码 <span style="font-size:0.7rem;color:var(--color-text-muted)">输入关键词自动搜索</span></label>
              <input type="text" class="input" id="f-symbol" required
                     placeholder="输入代码或名称搜索，如 AAPL、腾讯、茅台"
                     autocomplete="off" spellcheck="false">
              <div class="autocomplete__dropdown" id="symbol-dropdown"></div>
            </div>
            <div class="form-group">
              <label class="form-label">股票名称</label>
              <input type="text" class="input" id="f-name" required placeholder="选择后自动填充">
            </div>
          </div>
          
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">交易市场</label>
              <select class="select" id="f-market" required>
                <option value="">请选择市场</option>
                ${MARKET_IDS.map(id => `<option value="${id}">${MARKETS[id].flag} ${MARKETS[id].label} (${MARKETS[id].currency})</option>`).join('')}
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

  // ─── 自动补全逻辑 ───────────────────────────────────────────

  const symbolInput = document.getElementById('f-symbol');
  const nameInput   = document.getElementById('f-name');
  const marketSelect = document.getElementById('f-market');
  const dropdown    = document.getElementById('symbol-dropdown');

  let debounceTimer = null;
  let searchResults = [];
  let activeIndex   = -1;

  /**
   * 渲染下拉列表
   */
  function renderDropdown(results, isLoading = false) {
    if (isLoading) {
      dropdown.innerHTML = `
        <div class="autocomplete__loading">
          <div class="autocomplete__loading-spinner"></div>
          搜索中…
        </div>`;
      dropdown.classList.add('autocomplete__dropdown--visible');
      return;
    }

    if (!results || results.length === 0) {
      const query = symbolInput.value.trim();
      if (query.length >= 2) {
        dropdown.innerHTML = `<div class="autocomplete__empty">未找到匹配的股票 "${query}"</div>`;
        dropdown.classList.add('autocomplete__dropdown--visible');
      } else {
        hideDropdown();
      }
      return;
    }

    searchResults = results;
    activeIndex = -1;

    dropdown.innerHTML = results.map((item, i) => `
      <div class="autocomplete__item" data-index="${i}">
        <span class="autocomplete__item-symbol">${item.symbol}</span>
        <span class="autocomplete__item-name">${item.name}</span>
        <span class="autocomplete__item-meta">
          <span class="autocomplete__item-region">${item.region || ''}</span>
          <span class="autocomplete__item-currency">${item.currency || ''}</span>
        </span>
      </div>
    `).join('') + `
      <div class="autocomplete__hint">
        <kbd>↑↓</kbd> 导航 &nbsp; <kbd>Enter</kbd> 选择 &nbsp; <kbd>Esc</kbd> 关闭
      </div>`;

    dropdown.classList.add('autocomplete__dropdown--visible');

    // 绑定点击事件
    dropdown.querySelectorAll('.autocomplete__item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 防止 input blur 导致 dropdown 关闭
        selectItem(parseInt(el.dataset.index, 10));
      });
    });
  }

  /**
   * 选中某个搜索结果，自动填充表单
   */
  function selectItem(index) {
    const item = searchResults[index];
    if (!item) return;

    // 填充股票代码
    symbolInput.value = item.symbol;

    // 填充股票名称
    nameInput.value = item.name;

    // 自动推断并选择市场
    const market = inferMarket(item.region, item.symbol);
    if (market) {
      marketSelect.value = market;
    }

    hideDropdown();

    // 聚焦到价格输入框，提升录入效率
    document.getElementById('f-price')?.focus();
  }

  function hideDropdown() {
    dropdown.classList.remove('autocomplete__dropdown--visible');
    searchResults = [];
    activeIndex = -1;
  }

  function setActiveItem(index) {
    const items = dropdown.querySelectorAll('.autocomplete__item');
    items.forEach(el => el.classList.remove('autocomplete__item--active'));
    if (index >= 0 && index < items.length) {
      activeIndex = index;
      items[index].classList.add('autocomplete__item--active');
      items[index].scrollIntoView({ block: 'nearest' });
    }
  }

  // ─── 事件绑定 ───

  // 输入时防抖搜索
  symbolInput.addEventListener('input', () => {
    const query = symbolInput.value.trim();

    if (debounceTimer) clearTimeout(debounceTimer);

    if (query.length < 2) {
      hideDropdown();
      return;
    }

    // 显示加载状态
    renderDropdown(null, true);

    debounceTimer = setTimeout(async () => {
      try {
        const results = await searchStock(query);
        // 仅在 input 值未变化时渲染结果
        if (symbolInput.value.trim() === query) {
          renderDropdown(results);
        }
      } catch (err) {
        console.error('[Autocomplete] Search error:', err);
        renderDropdown([]);
      }
    }, 400);
  });

  // 键盘导航
  symbolInput.addEventListener('keydown', (e) => {
    if (!dropdown.classList.contains('autocomplete__dropdown--visible')) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveItem(Math.min(activeIndex + 1, searchResults.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveItem(Math.max(activeIndex - 1, 0));
        break;
      case 'Enter':
        if (activeIndex >= 0) {
          e.preventDefault();
          selectItem(activeIndex);
        }
        break;
      case 'Escape':
        e.preventDefault();
        hideDropdown();
        break;
    }
  });

  // 失焦时关闭下拉（延迟以允许点击项目）
  symbolInput.addEventListener('blur', () => {
    setTimeout(hideDropdown, 200);
  });

  // 重新聚焦时，如果有内容且无结果则触发搜索
  symbolInput.addEventListener('focus', () => {
    if (searchResults.length > 0) {
      dropdown.classList.add('autocomplete__dropdown--visible');
    }
  });

  // 点击页面其他区域关闭下拉
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete')) {
      hideDropdown();
    }
  });

  // ─── 表单提交 ───────────────────────────────────────────────

  const form = container.querySelector('#trade-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-trade');
    btn.disabled = true;
    btn.textContent = '保存中...';
    
    try {
      const marketId = document.getElementById('f-market').value;
      const currency = MARKETS[marketId]?.currency || 'CNY';

      // Fetch live exchange rate at time of trade entry
      let open_rate_to_cny = 1;
      if (currency !== 'CNY') {
        try {
          const rates = await getExchangeRates();
          open_rate_to_cny = rates[currency] ? 1 / rates[currency] : 1;
        } catch (_) {}
      }

      const data = {
        symbol: document.getElementById('f-symbol').value,
        name: document.getElementById('f-name').value,
        market: marketId,
        currency,
        open_rate_to_cny,
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
