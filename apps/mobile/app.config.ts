import type { ConfigContext, ExpoConfig } from 'expo/config';

/** EAS file variable or local Firebase client config; service-account keys stay in EAS credentials. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const firebaseFile = process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile;
  const apiURL = process.env.EXPO_PUBLIC_API_URL;
  const passkeyDomain = process.env.EXPO_PUBLIC_PASSKEY_RP_ID || (apiURL?.startsWith('https://') ? new URL(apiURL).hostname : undefined);
  return {
    ...config,
    name: config.name ?? 'Sendraa',
    slug: config.slug ?? 'sendraa',
    plugins: [...(config.plugins ?? []), ...(passkeyDomain ? [['./plugins/with-passkey-domain.cjs', { domain: passkeyDomain }] as [string, { domain: string }]] : [])],
    ios: {
      ...config.ios,
      appleTeamId: process.env.APPLE_TEAM_ID || config.ios?.appleTeamId,
      associatedDomains: [...new Set([...(config.ios?.associatedDomains ?? []), ...(passkeyDomain ? [`webcredentials:${passkeyDomain}`] : [])])],
    },
    android: {
      ...config.android,
      ...(firebaseFile ? { googleServicesFile: firebaseFile } : {}),
    },
  };
};
