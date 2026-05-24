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
 * Verify Authorization token
 * @param {EventContext} context
 */
async function authHandler({ request, env, next }) {
  const url = new URL(request.url);
  // Bypass auth for login endpoint and OPTIONS
  if (url.pathname === '/api/auth/login' || request.method === 'OPTIONS') {
    return next();
  }
  
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
