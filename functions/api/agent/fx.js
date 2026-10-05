/**
 * @fileoverview GET /api/agent/fx — Exchange rate breakdown.
 *
 * Route:
 *   GET /api/agent/fx
 *
 * Returns detailed exchange rates used for portfolio CNY conversion,
 * including per-currency rateToCNY, source (database / live / fallback / system),
 * and last updated timestamp.
 */

import {
  loadRatesDetailed,
  successResponse,
  errorResponse,
} from '../../../lib/agent-common.js';

export async function onRequestGet({ env }) {
  try {
    const detailed = await loadRatesDetailed(env?.DB);

    return successResponse({
      baseCurrency: detailed.baseCurrency,
      rates: detailed.rates,
      pairs: detailed.pairs,
    });
  } catch (err) {
    console.error('[agent:fx]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取汇率明细', 500);
  }
}
