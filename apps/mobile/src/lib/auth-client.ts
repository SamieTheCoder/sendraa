import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';

/**
 * The control-plane API. On a physical device, localhost is the phone, so set
 * EXPO_PUBLIC_API_URL to your computer's LAN address while developing.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
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
