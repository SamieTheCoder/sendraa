import { Platform } from 'react-native';

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

/**
 * How a request carries the session. Native stores the session cookie itself (Keychain / Keystore)
 * and sends it as a header. Browsers forbid setting the Cookie header, so on web the browser's own
 * cookie jar is used instead (`credentials: 'include'`), as the auth client already does.
 */
export async function sessionInit(): Promise<{ headers: Record<string, string>; credentials: RequestCredentials }> {
  if (Platform.OS === 'web') return { headers: {}, credentials: 'include' };
  // The cookie is sent by hand; letting fetch add its own interferes.
  return { headers: { cookie: await authClient.getCookie() }, credentials: 'omit' };
}

/** Calls the control-plane API with the stored session cookie. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    const session = await sessionInit();
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...session.headers },
      credentials: session.credentials,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    if (init.signal?.aborted) throw new ApiError(0, 'TIMEOUT', 'The request timed out. Try again to check or save your settings.');
    throw new ApiError(0, 'OFFLINE', `Cannot reach Sendraa at ${API_URL}. Check your connection.`);
  }

  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? `Request failed (${res.status}).`);
  }
  return json as T;
}
