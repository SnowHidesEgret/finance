/**
 * StockVault — 市场专区页
 */
import { MARKET_IDS, MARKETS } from '../utils/constants.js';
import { navigate } from '../router/index.js';

export async function renderMarketPage(container, params) {
  const currentMarket = params?.id || MARKET_IDS[0];
  
  container.innerHTML = `
    <div class="page-container animate-fade-in-up">
      <div class="page-header">
        <h2 class="page-title">市场专区</h2>
      </div>
      
      <div style="display:flex; gap:16px; margin-bottom:24px;">
        ${MARKET_IDS.map(id => `
          <button class="btn ${currentMarket === id ? 'btn--primary' : 'btn--ghost'}" 
                  onclick="window.location.hash='#/market/${id}'">
            ${MARKETS[id].flag} ${MARKETS[id].label}
          </button>
        `).join('')}
      </div>
      
      <div class="card" style="min-height: 400px; display:flex; align-items:center; justify-content:center;">
        <div style="text-align:center; color:var(--color-text-secondary)">
          <div style="font-size:3rem; margin-bottom:16px;">${MARKETS[currentMarket].flag}</div>
          <h3>${MARKETS[currentMarket].label} 市场视图正在开发中</h3>
          <p>此处将展示该市场的整体走势、指数对比以及您在该市场的全部持仓详情。</p>
        </div>
      </div>
    </div>
  `;
}
