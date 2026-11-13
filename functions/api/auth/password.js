const PBKDF2_ITERATIONS = 10000;

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function sha256Hex(pwd) {
  const msgUint8 = new TextEncoder().encode(pwd);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  return bytesToHex(new Uint8Array(hashBuffer));
}

async function hashPasswordPBKDF2(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return `pbkdf2:${iterations}:${saltHex}:${bytesToHex(new Uint8Array(derivedBits))}`;
}

async function createPasswordHash(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(saltBytes);
  return hashPasswordPBKDF2(password, saltHex, PBKDF2_ITERATIONS);
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const computed = await hashPasswordPBKDF2(password, saltHex, iterations);
    return computed === storedHash;
  }
  const inputHash = await sha256Hex(password);
  return inputHash === storedHash;
}

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

    // Check if master_password_hash exists in db
    const stmt = await db.prepare("SELECT value FROM user_settings WHERE key = 'master_password_hash'").first();

    if (!stmt || !stmt.value) {
      return new Response(JSON.stringify({ success: false, error: '系统尚未设置密码' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const isOldValid = await verifyPassword(oldPassword, stmt.value);
    if (!isOldValid) {
      return new Response(JSON.stringify({ success: false, error: '原密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const newHash = await createPasswordHash(newPassword);

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
