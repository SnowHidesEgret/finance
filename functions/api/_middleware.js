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
 * Verify a stateless HMAC session token (`st1.<expiresAt>.<nonce>.<sigHex>`)
 * against the stored master_password_hash.
 * @param {string} token
 * @param {string} secretHash
 * @returns {Promise<boolean>}
 */
async function verifySignedSessionToken(token, secretHash) {
  if (!token || !secretHash || !token.startsWith('st1.')) return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false;

  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const expectedSigHex = parts[3];

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretHash),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const computedSigHex = Array.from(new Uint8Array(sigBuf), (b) => b.toString(16).padStart(2, '0')).join('');

  if (computedSigHex.length !== expectedSigHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedSigHex.length; i++) {
    diff |= computedSigHex.charCodeAt(i) ^ expectedSigHex.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify Authorization token (session or API Key).
 *
 * Auth routing logic:
 *  - /api/auth/login          → bypass (no auth needed)
 *  - /api/agent/*             → API Key auth (for external agents; Authorization header only)
 *  - everything else          → session token auth (includes /api/settings/apikey)
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

  const isAgentRoute = pathname.startsWith('/api/agent/');

  // ── Agent API routes → API Key auth (Authorization header only) ────
  if (isAgentRoute) {
    const authHeader = request.headers.get('Authorization') || '';
    let apiKey = '';

    if (authHeader.toLowerCase().startsWith('bearer sk-')) {
      apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    }

    if (!apiKey) {
      return jsonResponse({
        success: false,
        error: { code: 'MISSING_API_KEY', message: '缺少 API Key，请在 Authorization 请求头中提供（不支持查询参数）' },
      }, 401);
    }

    const valid = await verifyApiKey(env.DB, apiKey);
    if (!valid) {
      return jsonResponse({
        success: false,
        error: { code: 'INVALID_API_KEY', message: '提供的 API Key 无效，或已在设置页被重新生成/撤销' },
      }, 401);
    }

    return next();
  }

  // ── All other routes → session token ───────────────────────────────
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return jsonResponse({ success: false, error: '未授权，请登录' }, 401);
  }

  try {
    const db = env.DB;
    const { results } = await db.prepare(
      "SELECT key, value FROM user_settings WHERE key IN ('auth_token', 'master_password_hash')"
    ).all();

    const settingsMap = {};
    for (const row of results || []) {
      settingsMap[row.key] = row.value;
    }

    let isValidSession = false;
    if (token.startsWith('st1.') && settingsMap.master_password_hash) {
      isValidSession = await verifySignedSessionToken(token, settingsMap.master_password_hash);
    } else if (settingsMap.auth_token && settingsMap.auth_token === token) {
      // Legacy UUID token fallback
      isValidSession = true;
    }

    if (!isValidSession) {
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
