const crypto = require('node:crypto');

// Encrypts just the Plex auth token before it's persisted to sessions.sqlite
// (see server.js's EncryptedSessionStore) — everything else in the session
// stays plaintext, this is field-level, not whole-session, encryption.
// AES-256-GCM keyed from SESSION_SECRET (already this app's own server-side
// secret — same reuse pattern as lib/recapUnsubscribe.js, rather than adding
// a second .env secret just for this). Deterministic key derivation so
// tokens encrypted before a restart still decrypt after one.
const KEY = crypto.createHash('sha256').update(String(process.env.SESSION_SECRET || '')).digest();
const PREFIX = 'enc:v1:';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

// Sessions written before this fix shipped (or a value that no longer
// decrypts, e.g. after SESSION_SECRET rotates) pass through unchanged rather
// than throwing — a token that doesn't decrypt just means the next
// login/session save re-encrypts it under the current key, not a hard
// failure for whoever's mid-session.
function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('session token decrypt error', err.message);
    return value;
  }
}

module.exports = { encrypt, decrypt };
