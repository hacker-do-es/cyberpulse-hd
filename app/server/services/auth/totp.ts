import crypto from 'crypto';

/* TOTP (RFC 6238): SHA-1, 30 s steps, 6 digits, compatible with Google /
   Microsoft Authenticator and 1Password. */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/* Returns the matched time step (to block replay of the same code) or null. */
export function verifyTotp(secret: string, code: unknown, now = Date.now(), window = 1): number | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return null;
  const current = Math.floor(now / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const step = current + w;
    if (crypto.timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code.trim()))) return step;
  }
  return null;
}

export function totpUri(issuer: string, account: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
