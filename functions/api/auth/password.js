export async function onRequestPut(context) {
  const { request, env } = context;
  const db = env.DB;
  
  try {
    const body = await request.json();
    const oldPassword = body.oldPassword;
    const newPassword = body.newPassword;
    
    if (!oldPassword || !newPassword) {
      return new Response(JSON.stringify({ success: false, error: '缺少密码参数' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash helper
    async function hashPassword(pwd) {
      const msgUint8 = new TextEncoder().encode(pwd);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const oldHash = await hashPassword(oldPassword);
    const newHash = await hashPassword(newPassword);
    
    // Check if master_password_hash exists in db
    const stmt = await db.prepare("SELECT value FROM user_settings WHERE key = 'master_password_hash'").first();
    
    if (!stmt) {
      return new Response(JSON.stringify({ success: false, error: '系统尚未设置密码' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (stmt.value !== oldHash) {
      return new Response(JSON.stringify({ success: false, error: '原密码错误' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Update password
    await db.prepare("UPDATE user_settings SET value = ?, updated_at = datetime('now') WHERE key = 'master_password_hash'")
      .bind(newHash)
      .run();
    
    // Invalidate auth token so user has to login again
    await db.prepare("DELETE FROM user_settings WHERE key = 'auth_token'").run();
      
    return new Response(JSON.stringify({ success: true, data: { message: '密码修改成功，请重新登录' } }), { 
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
