import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { env } from './env.js';

/**
 * AES-256-GCM for secrets the platform must read back, such as each tenant's
 * Worker secret. Stored as base64(iv || tag || ciphertext). The key is derived
 * from BETTER_AUTH_SECRET so there is one secret to manage and rotate.
 */
const key = Buffer.from(hkdfSync('sha256', env.BETTER_AUTH_SECRET, 'sendraa', 'sendraa:secrets:v1', 32));

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function open(sealed: string): string {
  const buf = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export const newSecret = () => randomBytes(32).toString('base64url');
