const { withAndroidManifest, withStringsXml, AndroidConfig } = require('expo/config-plugins');

/** Generated during prebuild; never edit AndroidManifest.xml by hand. */
module.exports = function withPasskeyDomain(config, { domain }) {
  const origin = new URL(`https://${domain}`);
  if (origin.hostname !== domain || origin.pathname !== '/') throw new Error('Passkey domain must be a hostname.');
  config = withStringsXml(config, (config) => {
    const strings = config.modResults.resources.string ?? [];
    config.modResults.resources.string = strings.filter((entry) => entry.$.name !== 'asset_statements');
    config.modResults.resources.string.push({
      $: { name: 'asset_statements', translatable: 'false' },
      _: JSON.stringify([{ include: `${origin.origin}/.well-known/assetlinks.json` }]).replaceAll('"', '\\"'),
    });
    return config;
  });
  return withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app['meta-data'] = (app['meta-data'] ?? []).filter((entry) => entry.$['android:name'] !== 'asset_statements');
    app['meta-data'].push({ $: { 'android:name': 'asset_statements', 'android:resource': '@string/asset_statements' } });
    return config;
  });
};
