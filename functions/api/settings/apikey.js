/**
 * @fileoverview Agent API Key management.
 *
 * Routes:
 *   GET    /api/settings/apikey  — check if an API key is configured
 *   POST   /api/settings/apikey  — generate a new API key (returns plaintext once)
 *   DELETE /api/settings/apikey  — revoke the current API key
 *
 * Authentication: session-token (handled by the global _middleware.js authHandler).
 * The API key managed here is a *separate* credential used by external
 * tools (e.g. the `sv` CLI, AI agents) to call the read-only Agent API
 * endpoints under /api/agent/*.
 */

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Build a standard Agent API JSON response with `meta` envelope.
 * @param {object}  data       — response payload
 * @param {number}  [status=200]
 * @returns {Response}
 */
function respond(data, status = 200) {
  return Response.json({
    success: true,
    data,
    meta: { timestamp: new Date().toISOString(), version: 'v1' },
  }, { status });
}

/**
 * Build an error response.
 * @param {string} message
 * @param {number} [status=400]
 * @returns {Response}
 */
function errorResponse(message, status = 400) {
  return Response.json({
    success: false,
    error: message,
    meta: { timestamp: new Date().toISOString(), version: 'v1' },
  }, { status });
}

/**
 * Generate a cryptographically random hex string of the given byte length.
 * @param {number} byteLength
 * @returns {string} hex-encoded string (2 × byteLength chars)
 */
function randomHex(byteLength) {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 hash a string, returning hex digest.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function sha256(text) {
  const encoded = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ────────────────────────────────────────────────────────────
// GET /api/settings/apikey
// ────────────────────────────────────────────────────────────

/**
 * Check whether an Agent API Key has been configured.
 * @param {EventContext} context
 */
export async function onRequestGet({ env }) {
  const db = env.DB;

  const row = await db.prepare(
    "SELECT value FROM user_settings WHERE key = 'openclaw_api_key_hash'"
  ).first();

  if (!row) {
    return respond({ configured: false, createdAt: null });
  }

  // Fetch the creation timestamp if available
  const tsRow = await db.prepare(
    "SELECT value FROM user_settings WHERE key = 'openclaw_api_key_created_at'"
  ).first();

  return respond({
    configured: true,
    createdAt: tsRow ? tsRow.value : null,
  });
}

// ────────────────────────────────────────────────────────────
// POST /api/settings/apikey
// ────────────────────────────────────────────────────────────

/**
 * Generate a new API Key. The plaintext key is returned exactly once.
 * @param {EventContext} context
 */
export async function onRequestPost({ env }) {
  const db = env.DB;

  // Generate key: sk- + 40 hex chars (20 random bytes)
  const plaintext = `sk-${randomHex(20)}`;
  const hash = await sha256(plaintext);
  const now = new Date().toISOString();

  // Upsert hash and creation timestamp
  const upsertSQL = `
    INSERT INTO user_settings (key, value, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `;

  await db.batch([
    db.prepare(upsertSQL).bind('openclaw_api_key_hash', hash, now),
    db.prepare(upsertSQL).bind('openclaw_api_key_created_at', now, now),
  ]);

  return respond({
    apiKey: plaintext,
    message: '请妥善保存此密钥，它只会显示一次',
  }, 201);
}

// ────────────────────────────────────────────────────────────
// DELETE /api/settings/apikey
// ────────────────────────────────────────────────────────────

/**
 * Revoke (delete) the current API Key.
 * @param {EventContext} context
 */
export async function onRequestDelete({ env }) {
  const db = env.DB;

  await db.batch([
    db.prepare("DELETE FROM user_settings WHERE key = 'openclaw_api_key_hash'"),
    db.prepare("DELETE FROM user_settings WHERE key = 'openclaw_api_key_created_at'"),
  ]);

  return respond({ message: 'API Key 已撤销' });
}
