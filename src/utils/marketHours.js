/**
 * StockVault — 市场交易时间判断
 */

/**
 * 判断市场是否处于开市状态 (轻量级，基于系统 Intl 时区计算)
 * @param {string} marketId 市场标识
 * @returns {boolean} 是否开市
 */
export function isMarketOpen(marketId) {
  const rules = {
    A_SHARE: {
      timeZone: 'Asia/Shanghai',
      isOpen: (h, m) => (h === 9 && m >= 30) || (h >= 10 && h < 11) || (h === 11 && m <= 30) || (h >= 13 && h < 15)
    },
    HK: {
      timeZone: 'Asia/Hong_Kong',
      isOpen: (h, m) => (h === 9 && m >= 30) || (h >= 10 && h < 12) || (h === 12 && m === 0) || (h >= 13 && h < 16)
    },
    US: {
      timeZone: 'America/New_York',
      isOpen: (h, m) => (h === 9 && m >= 30) || (h >= 10 && h < 16)
    },
    SWISS: {
      timeZone: 'Europe/Zurich',
      isOpen: (h, m) => (h >= 9 && h < 17) || (h === 17 && m <= 30)
    }
  };

  const rule = rules[marketId];
  if (!rule) return false;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: rule.timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    
    const parts = formatter.formatToParts(new Date());
    const values = {};
    for (const part of parts) {
      values[part.type] = part.value;
    }
    
    const weekday = values.weekday;
    if (weekday === 'Sat' || weekday === 'Sun') return false;
    
    const hour = parseInt(values.hour, 10);
    const minute = parseInt(values.minute, 10);

    return rule.isOpen(hour, minute);
  } catch (e) {
    console.warn('Error calculating market time:', e);
    return false;
  }
}
