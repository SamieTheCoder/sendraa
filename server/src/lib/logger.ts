import pino from 'pino';
import { env } from '../env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Mail bodies and credentials must never reach the log stream.
  redact: {
    paths: [
      'text_body',
      'html_body',
      'raw',
      'secret',
      'secret_cipher',
      'apiKey',
      'password',
      'req.headers.authorization',
    ],
    censor: '[redacted]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
