import { serve } from '@hono/node-server';

import { app } from './app.js';
import { pool } from './db.js';
import { env } from './env.js';

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`sendraa api listening on http://localhost:${info.port}`);
});

const shutdown = () => {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
