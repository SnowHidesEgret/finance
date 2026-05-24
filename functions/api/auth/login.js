export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  
  try {
    const body = await request.json();
    const password = body.password;
    
    if (!password) {
      return new Response(JSON.stringify({ success: false, error: 'Missing password' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash password with SHA-256
    const msgUint8 = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const inputHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Check if master_password_hash exists in db
    const stmt = await db.prepare("SELECT value FROM user_settings WHERE key = 'master_password_hash'").first();
    
    let isValid = false;
    let isFirstLogin = false;
    
    if (!stmt) {
      // First time login - set this password as the master password
      await db.prepare("INSERT INTO user_settings (key, value) VALUES ('master_password_hash', ?)").bind(inputHash).run();
      isValid = true;
      isFirstLogin = true;
    } else {
      // Compare
      const storedHash = stmt.value;
      isValid = (storedHash === inputHash);
    }
    
    if (isValid) {
      // Generate a new token
      const token = crypto.randomUUID();
      // Save to user_settings (overwrite existing or insert)
      await db.prepare(`
        INSERT INTO user_settings (key, value) VALUES ('auth_token', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).bind(token).run();
      
      return new Response(JSON.stringify({ success: true, data: { token, isFirstLogin } }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ success: false, error: '密码错误' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
