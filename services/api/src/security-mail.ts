import nodemailer from 'nodemailer';

import { one } from './db.js';
import { env, recoveryConfigured } from './env.js';

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  requireTLS: env.SMTP_PORT !== 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  connectionTimeout: 10_000,
  socketTimeout: 15_000,
  disableFileAccess: true,
  disableUrlAccess: true,
});

export async function sendSecurityMail(to: string, subject: string, text: string) {
  if (!recoveryConfigured) throw new Error('Recovery email is not configured.');
  await transport.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject, text });
}

export async function sendPasswordReset(user: { id: string; email: string; emailVerified: boolean }, token: string) {
  const security = await one<{ recovery_email: string }>(
    'select recovery_email from account_security where user_id = $1 and recovery_verified_at is not null', [user.id],
  );
  // Never send a reset to an unverified alternate address.
  const recipient = security?.recovery_email ?? (user.emailVerified ? user.email : null);
  if (!recipient) return;
  const url = `${env.BETTER_AUTH_URL}/account/reset#token=${encodeURIComponent(token)}`;
  try {
    await sendSecurityMail(recipient, 'Reset your Sendraa password',
      `A password reset was requested for your Sendraa account.\n\n${url}\n\nThis link expires in 15 minutes and works once. Resetting your password signs out your other sessions.\n\nIf you did not request this, ignore this email. Your password has not changed.\n\nSendraa`);
  } catch {
    // A provider failure must not turn the public endpoint into an account oracle.
    console.error('Sendraa password-reset email delivery failed. Check the SMTP service.');
  }
}
