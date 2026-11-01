import { handleApi } from './api';
import { ingest } from './ingest';
import { log } from './util';

/**
 * sendraa-mail runs in the tenant's own Cloudflare account.
 *
 * email(): store what arrives. fetch(): answer the platform. No rendering,
 * templating, search indexing or spam scoring happens here (ARCHITECTURE.md F4c).
 */
export default {
  async email(message, env, ctx) {
    try {
      await ingest(message, env, ctx);
    } catch (err) {
      log('error', 'ingest failed', { error: err instanceof Error ? err.message : String(err) });
      // Rethrow so delivery fails visibly instead of the message vanishing.
      throw err;
    }
  },

  async fetch(request, env) {
    try {
      return await handleApi(request, env);
    } catch (err) {
      log('error', 'api failed', { path: new URL(request.url).pathname, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: { code: 'INTERNAL', message: 'Internal error.' } }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
