/**
 * Release hardening that app.json can't express on its own. Must be the
 * first plugin in app.json: mods run in reverse order, so it then runs last
 * and its removals stick.
 *
 * - Android: asks Google Play to download the ML Kit text model when the app
 *   is installed, so reading box labels works offline the first time.
 * - iOS: Clew only schedules local notifications, so the push entitlement
 *   (aps-environment) that expo-notifications adds is removed.
 * - iOS: no arbitrary network loads; Clew only talks to Hugging Face over
 *   HTTPS to download the optional model. Local networking stays allowed so
 *   development builds can reach Metro.
 */
const { AndroidConfig, withAndroidManifest, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

function withMlKitOcr(config) {
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.google.mlkit.vision.DEPENDENCIES', 'ocr');
    return c;
  });
}

function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });
}

function withStrictTransportSecurity(config) {
  return withInfoPlist(config, (c) => {
    c.modResults.NSAppTransportSecurity = { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true };
    return c;
  });
}

module.exports = (config) => withStrictTransportSecurity(withoutPushEntitlement(withMlKitOcr(config)));
