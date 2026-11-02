import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { PasskeyCreateRequest, PasskeyGetRequest } from 'react-native-passkey';

import { authClient } from './auth-client';
import { authError } from './auth-feedback';

export type PasskeyRecord = { id: string; name?: string; createdAt: string };
export async function passkeyAvailability(serverEnabled: boolean): Promise<{ available: boolean; reason: string | null }> {
  if (Constants.executionEnvironment === 'storeClient') return { available: false, reason: 'Passkeys are not supported in Expo Go. Install a Sendraa development or release build to use them.' };
  if (Platform.OS === 'web') return { available: false, reason: 'Passkey sign-in is currently supported in the Sendraa iOS and Android apps.' };
  if (!serverEnabled) return { available: false, reason: 'Passkeys are not enabled for this platform yet. Sendraa’s server needs its passkey domain and this app’s signing association configured.' };
  if (!await passkeysSupported()) return { available: false, reason: 'This device or app build does not support passkeys. Use Cloudflare or your password to sign in.' };
  return { available: true, reason: null };
}
export async function passkeysSupported() {
  // The native module is deliberately never evaluated in Expo Go or on web.
  if (Constants.executionEnvironment === 'storeClient' || Platform.OS === 'web') return false;
  try { return (await import('react-native-passkey')).Passkey.isSupported(); } catch { return false; }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const { data, error } = await authClient.$fetch<T>(path, { method: body ? 'POST' : 'GET', ...(body ? { body } : {}) });
  if (error) throw new Error(authError(error));
  if (!data) throw new Error('Passkey request did not finish. Try again.');
  return data;
}
export async function signInWithPasskey() {
  const { Passkey } = await import('react-native-passkey');
  const options = await request<PasskeyGetRequest>('/passkey/generate-authenticate-options');
  const response = await Passkey.get(options);
  await request('/passkey/verify-authentication', { response: { ...response, rawId: response.rawId ?? response.id, type: response.type ?? 'public-key', clientExtensionResults: response.clientExtensionResults ?? {} } });
  await authClient.getSession();
}
export async function addPasskey() {
  const { Passkey } = await import('react-native-passkey');
  const options = await request<PasskeyCreateRequest>('/passkey/generate-register-options');
  const response = await Passkey.create(options);
  await request('/passkey/verify-registration', { response: { ...response, type: response.type ?? 'public-key', clientExtensionResults: response.clientExtensionResults ?? {} }, name: Platform.OS === 'ios' ? 'iPhone / iCloud Keychain' : 'Android / Password Manager' });
}
export const listPasskeys = () => request<PasskeyRecord[]>('/passkey/list-user-passkeys');
export const deletePasskey = (id: string) => request('/passkey/delete-passkey', { id });
