import { expoClient } from '@better-auth/expo/client';
import { multiSessionClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { recordAuthRateLimit } from './auth-feedback';

/**
 * The control-plane API. On a physical device, localhost is the phone, so set
 * EXPO_PUBLIC_API_URL to your computer's LAN address while developing.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { onError: ({ response }) => recordAuthRateLimit(response) },
  plugins: [
    multiSessionClient(),
    expoClient({
      scheme: 'sendraa',
      storagePrefix: 'sendraa',
      // Session cookies live in the Keychain / Keystore, never in plain storage.
      storage: SecureStore,
      // A fresh browser cookie jar for every sign-in. Cloudflare's login keeps a
      // CSRF cookie per attempt; leftovers from an earlier or abandoned attempt
      // in the shared Safari jar cause "No CSRF value available in the session
      // cookie" (request_forbidden). The cost is logging in to Cloudflare each time.
      webBrowserOptions: { preferEphemeralSession: true },
    }),
  ],
});

/**
 * Where an OAuth sign-in returns to. Native uses app paths, which the Expo plugin turns into
 * `sendraa://` deep links. On web a relative path would resolve against the API's host, so it must
 * be this page's own origin (app.sendraa.tech, or localhost in development).
 */
export function authReturnURL(path: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}${path}`;
  return path;
}
