import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Inbound SMTP. Port 25 is the only port remote MTAs will use to reach us.
  SMTP_PORT: z.coerce.number().int().positive().default(25),
  SMTP_HOST: z.string().default('0.0.0.0'),
  SMTP_BANNER: z.string().default('Sendraa'),
  // Must match the PTR record of the public IP or receivers will distrust us.
  SMTP_HOSTNAME: z.string().default('mx.sendraa.app'),

  // Hard ceiling on accepted message size. Cloudflare and most providers cap
  // at 25 MiB; matching that keeps behaviour predictable for tenants.
  MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(26_214_400),

  // Optional STARTTLS for inbound. Without it mail still arrives, but in the
  // clear, and some senders downgrade-warn. Strongly recommended in prod.
  SMTP_TLS_KEY_PATH: z.string().optional(),
  SMTP_TLS_CERT_PATH: z.string().optional(),

  // Raw MIME storage. 'fs' writes under RAW_STORAGE_PATH; 's3' targets any
  // S3-compatible endpoint (R2, MinIO).
  RAW_STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  RAW_STORAGE_PATH: z.string().default('./.mailstore'),

  // 32-byte hex key used to encrypt tenant relay credentials at rest.
  SECRETS_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_KEY must be 64 hex characters (32 bytes)'),

  API_PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
export type Env = typeof env;
