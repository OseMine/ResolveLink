/**
 * Notarization script for macOS
 * Run after electron-builder builds the DMG
 */

const { notarize } = require('@electron/notarize');

exports.default = async function notarize(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = 'ResolveLink';
  const appPath = `${appOutDir}/${context.packager.appInfo.productName}.app`;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization: APPLE_ID, APPLE_ID_PASSWORD, or APPLE_TEAM_ID not set');
    return;
  }

  try {
    return await notarize({
      appBundleId: 'com.resolvelink.app',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
  } catch (err) {
    console.error('Notarization failed:', err.message);
    // Don't fail the build if notarization fails
    console.log('Continuing build despite notarization failure...');
  }
};