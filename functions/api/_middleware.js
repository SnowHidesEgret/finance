/**
 * @fileoverview Global middleware for all /api/* routes.
 *
 * Responsibilities:
 *  1. CORS headers (allow all origins for development)
 *  2. Automatic try/catch with JSON error envelope
 *  3. X-Response-Time timing header
 */

/** @type {Record<string, string>} */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/**
 * Build a JSON Response with CORS headers baked in.
 * @param {object}  body        – response payload
 * @param {number}  [status=200] – HTTP status code
 * @param {Record<string, string>} [extraHeaders={}] – any extra headers
 * @returns {Response}
 */
function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Cloudflare Pages middleware handler.
 * @param {EventContext} context
 */
async function errorHandler({ next }) {
  const start = Date.now();

  try {
    const response = await next();

    // Inject CORS + timing into every response
    const elapsed = Date.now() - start;
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      response.headers.set(k, v);
    }
    response.headers.set('X-Response-Time', `${elapsed}ms`);

    return response;
  } catch (err) {
    const elapsed = Date.now() - start;
    const status = err.status || 500;
    const message =
      status === 500 ? 'Internal server error' : err.message || 'Unknown error';

    // Log the real error for debugging on the worker side
    console.error('[middleware]', err);

    return jsonResponse(
      { success: false, error: message },
      status,
      { 'X-Response-Time': `${elapsed}ms` },
    );
  }
}

/**
 * Handle CORS pre-flight (OPTIONS) requests early.
 * @param {EventContext} context
 */
async function corsHandler({ request, next }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return next();
}

/**
 * Hash a string with SHA-256 and return the hex digest.
 * @param {string} str
 * @returns {Promise<string>}
 */
async function sha256Hex(str) {
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  return Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify API Key against the stored hash in user_settings.
 * @param {D1Database} db
 * @param {string} apiKey - plaintext API Key (e.g. "sk-abc123...")
 * @returns {Promise<boolean>}
 */
async function verifyApiKey(db, apiKey) {
  if (!apiKey || !apiKey.startsWith('sk-')) return false;
  try {
    const row = await db.prepare("SELECT value FROM user_settings WHERE key = 'openclaw_api_key_hash'").first();
    if (!row || !row.value) return false;
    const inputHash = await sha256Hex(apiKey);
    return inputHash === row.value;
  } catch (err) {
    console.error('[auth:apikey]', err);
    return false;
  }
}

/**
 * Verify Authorization token (session or API Key).
 * 
 * Auth routing logic:
 *  - /api/auth/login          → bypass (no auth needed)
 *  - /api/openclaw/apikey     → session token auth (manage keys via UI)
 *  - /api/openclaw/*          → API Key auth (for external agents)
 *  - everything else          → session token auth
 *
 * @param {EventContext} context
 */
async function authHandler({ request, env, next }) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Bypass auth for login endpoint and OPTIONS
  if (pathname === '/api/auth/login' || request.method === 'OPTIONS') {
    return next();
  }

  const isOpenClawRoute = pathname.startsWith('/api/openclaw/');
  const isApiKeyMgmt = pathname === '/api/openclaw/apikey';

  // ── OpenClaw data routes → API Key auth ──────────────────────────
  if (isOpenClawRoute && !isApiKeyMgmt) {
    // Extract API Key from Authorization header or query param
    const authHeader = request.headers.get('Authorization') || '';
    let apiKey = '';

    if (authHeader.toLowerCase().startsWith('bearer sk-')) {
      apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    } else {
      apiKey = url.searchParams.get('api_key') || '';
    }

    if (!apiKey) {
      return jsonResponse({
        success: false,
        error: { code: 'MISSING_API_KEY', message: '缺少 API Key，请在请求头或查询参数中提供' },
      }, 401);
    }

    const valid = await verifyApiKey(env.DB, apiKey);
    if (!valid) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_API_KEY', message: '提供的 API Key 无效或已过期' },
      }, 401);
    }

    return next();
  }

  // ── All other routes (including /api/openclaw/apikey) → session token ─
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return jsonResponse({ success: false, error: '未授权，请登录' }, 401);
  }

  try {
    const db = env.DB;
    const stmt = await db.prepare("SELECT value FROM user_settings WHERE key = 'auth_token'").first();

    if (!stmt || stmt.value !== token) {
      return jsonResponse({ success: false, error: '登录已失效，请重新登录' }, 401);
    }
  } catch (err) {
    console.error('[auth]', err);
    return jsonResponse({ success: false, error: '数据库验证错误' }, 500);
  }

  return next();
}

// Middleware chain — CORS runs first, then error/timing wrapper, then auth.
export const onRequest = [corsHandler, errorHandler, authHandler];
