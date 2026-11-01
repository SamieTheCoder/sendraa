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
    }),
  ],
});
