/**
 * @fileoverview GET /api/settings and PUT /api/settings
 */

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;
  
  try {
    const rows = await db.prepare(
      "SELECT key, value FROM user_settings WHERE key NOT IN ('master_password_hash', 'auth_token')"
    ).all();
    
    const settings = {};
    if (rows && rows.results) {
      for (const row of rows.results) {
        settings[row.key] = row.value;
      }
    }
    
    // Ensure default empty values if not set
    if (settings.finnhub_api_key === undefined) settings.finnhub_api_key = '';
    if (settings.alpha_vantage_api_key === undefined) settings.alpha_vantage_api_key = '';
    
    return new Response(JSON.stringify({ success: true, data: settings }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const db = env.DB;
  
  try {
    const body = await request.json();
    
    const stmt = db.prepare(`
      INSERT INTO user_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);
    
    const statements = [];
    for (const [key, value] of Object.entries(body)) {
      if (key === 'master_password_hash' || key === 'auth_token') {
        continue; // Protect sensitive keys from being overridden here
      }
      statements.push(stmt.bind(key, String(value)));
    }
    
    if (statements.length > 0) {
      await db.batch(statements);
    }
    
    return new Response(JSON.stringify({ success: true, data: { message: '设置更新成功' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
