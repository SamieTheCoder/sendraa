/**
 * Prints every OAuth scope Cloudflare exposes, so RESOURCE_SCOPES can be filled
 * in with verified identifiers rather than guesses.
 *
 *   CF_API_TOKEN=... pnpm --filter @sendraa/cloudflare scopes
 *
 * Requires any valid API token; the endpoint needs authentication but no
 * particular role.
 */
const token = process.env.CF_API_TOKEN;

if (!token) {
  console.error('CF_API_TOKEN is required');
  process.exit(1);
}

const res = await fetch('https://api.cloudflare.com/client/v4/oauth/scopes', {
  headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
});

const text = await res.text();

if (!res.ok) {
  console.error(`request failed (${res.status}):\n${text}`);
  process.exit(1);
}

const body = JSON.parse(text) as {
  success: boolean;
  errors: { code: number; message: string }[];
  result?: unknown;
};

if (!body.success) {
  console.error('cloudflare returned an error:', body.errors);
  process.exit(1);
}

const scopes = (body.result ?? []) as { id?: string; name?: string; description?: string }[];

console.log(`${scopes.length} scopes available:\n`);
for (const s of scopes) {
  console.log(`  ${s.id ?? s.name ?? '(unnamed)'}`);
  if (s.description) console.log(`      ${s.description}`);
}
