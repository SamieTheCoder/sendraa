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
  const response = await Passkey.get(options).catch((err)=>{throw nativePasskeyError(err);});
  await request('/passkey/verify-authentication', { response: { ...response, rawId: response.rawId ?? response.id, type: response.type ?? 'public-key', clientExtensionResults: response.clientExtensionResults ?? {} } });
  await authClient.getSession();
}
export async function addPasskey() {
  const { Passkey } = await import('react-native-passkey');
  const options = await request<PasskeyCreateRequest>('/passkey/generate-register-options');
  const response = await Passkey.create(options).catch((err)=>{throw nativePasskeyError(err);});
  await request('/passkey/verify-registration', { response: { ...response, type: response.type ?? 'public-key', clientExtensionResults: response.clientExtensionResults ?? {} }, name: Platform.OS === 'ios' ? 'iPhone / iCloud Keychain' : 'Android / Password Manager' });
}
export const listPasskeys = () => request<PasskeyRecord[]>('/passkey/list-user-passkeys');
export const deletePasskey = (id: string) => request('/passkey/delete-passkey', { id });

/** Native libraries reject with plain objects; preserve actionable errors in the UI. */
function nativePasskeyError(value: unknown): Error {
  const error=value as {error?:string;message?:string};
  if(error?.error==='UserCancelled')return new Error('Passkey request cancelled. You can try again.');
  if(error?.error==='NoCredentials')return new Error('No passkey was found. Sign in with your password, then add one in Account and security.');
  if(error?.error==='BadConfiguration'||/associated|RP ID|application.*identifier/i.test(error?.message??''))return new Error(Platform.OS === 'android' ? 'This Android build is not associated with the passkey domain. Ask your administrator to check its signing certificate in Digital Asset Links.' : 'This build is not associated with the passkey domain. Rebuild and reinstall Sendraa with its Associated Domains entitlement, then try again.');
  if(error?.error==='NoCreateOption')return new Error(Platform.OS === 'android' ? 'Enable a passkey provider such as Google Password Manager in Android Settings, sign in to it, and set a screen lock. Then try again.' : 'Enable a password manager with passkey support in iPhone Settings, then try again.');
  return new Error(error?.message||'Passkey request failed. Try again.');
}
