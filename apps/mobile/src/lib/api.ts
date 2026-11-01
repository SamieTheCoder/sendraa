import { API_URL, authClient } from './auth-client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the control-plane API with the stored session cookie. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        cookie: await authClient.getCookie(),
      },
      // The cookie is sent by hand above; letting fetch add its own interferes.
      credentials: 'omit',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', `Cannot reach Sendraa at ${API_URL}. Check your connection.`);
  }

  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? `Request failed (${res.status}).`);
  }
  return json as T;
}
