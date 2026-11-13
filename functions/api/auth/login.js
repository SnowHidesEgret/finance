const PBKDF2_ITERATIONS = 10000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

async function sha256Hex(str) {
  const msgUint8 = new TextEncoder().encode(str);
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
  if (!storedHash) return { valid: false, needsUpgrade: false };
  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return { valid: false, needsUpgrade: false };
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const computed = await hashPasswordPBKDF2(password, saltHex, iterations);
    return { valid: computed === storedHash, needsUpgrade: false };
  }
  // Legacy unsalted SHA-256 compatibility
  const inputHash = await sha256Hex(password);
  return { valid: inputHash === storedHash, needsUpgrade: true };
}

async function signSessionToken(secretHash) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(12)));
  const payload = `st1.${expiresAt}.${nonce}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretHash),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigHex = bytesToHex(new Uint8Array(sigBuf));
  return `${payload}.${sigHex}`;
}

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

    // Check if master_password_hash exists in db
    const stmt = await db.prepare("SELECT value FROM user_settings WHERE key = 'master_password_hash'").first();

    let isValid = false;
    let isFirstLogin = false;
    let activePasswordHash = stmt ? stmt.value : '';

    if (!stmt || !stmt.value) {
      // First time login - set this password as the master password with salted PBKDF2
      activePasswordHash = await createPasswordHash(password);
      await db.prepare(`
        INSERT INTO user_settings (key, value, updated_at) VALUES ('master_password_hash', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).bind(activePasswordHash).run();
      isValid = true;
      isFirstLogin = true;
    } else {
      const { valid, needsUpgrade } = await verifyPassword(password, stmt.value);
      isValid = valid;
      if (isValid && needsUpgrade) {
        // Seamlessly upgrade legacy SHA-256 hash to salted PBKDF2
        activePasswordHash = await createPasswordHash(password);
        await db.prepare(
          "UPDATE user_settings SET value = ?, updated_at = datetime('now') WHERE key = 'master_password_hash'"
        ).bind(activePasswordHash).run();
      }
    }

    if (isValid) {
      // Generate a multi-device stateless HMAC token bound to master_password_hash
      const token = await signSessionToken(activePasswordHash);
      // Also save latest token to user_settings for backward compatibility
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
