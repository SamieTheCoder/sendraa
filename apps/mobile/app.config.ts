import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  // Set this to the SAME host as the API's PASSKEY_RP_ID before an EAS build.
  const passkeyDomain = process.env.EXPO_PUBLIC_PASSKEY_DOMAIN;
  return {
    ...config,
    name: config.name ?? 'Sendraa',
    slug: config.slug ?? 'sendraa',
    ios: {
      ...config.ios,
      ...(passkeyDomain ? { associatedDomains: [`webcredentials:${passkeyDomain}`] } : {}),
    },
    android: {
      ...config.android,
      package: config.android?.package ?? 'com.scientificsamie.sendraa',
    },
  };
};
