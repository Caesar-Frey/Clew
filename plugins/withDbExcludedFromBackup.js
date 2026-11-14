/**
 * Keeps the encrypted catalog out of iCloud and computer backups on iOS.
 *
 * The database key lives in the Keychain as "this device only", so a backup
 * restored onto another phone would bring the database without its key and
 * the app could not open it. Excluding expo-sqlite's folder (Documents/SQLite)
 * means a new phone simply starts empty and the user restores a Clew backup.
 * Android already has allowBackup=false.
 */
const { withAppDelegate } = require('expo/config-plugins');

const MARKER = '// @clew: exclude database from backup';

const SWIFT = `    ${MARKER}
    if var sqliteDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
      .appendingPathComponent("SQLite", isDirectory: true) {
      try? FileManager.default.createDirectory(at: sqliteDir, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? sqliteDir.setResourceValues(values)
    }
`;

const ANCHOR = /^(\s*)return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/m;

function addExclusion(contents) {
  if (contents.includes(MARKER)) return contents;
  if (!ANCHOR.test(contents)) {
    throw new Error('withDbExcludedFromBackup: could not find didFinishLaunchingWithOptions in AppDelegate.swift');
  }
  return contents.replace(ANCHOR, (line) => `${SWIFT}${line}`);
}

const withDbExcludedFromBackup = (config) =>
  withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withDbExcludedFromBackup expects a Swift AppDelegate');
    }
    cfg.modResults.contents = addExclusion(cfg.modResults.contents);
    return cfg;
  });

module.exports = withDbExcludedFromBackup;
module.exports.addExclusion = addExclusion;
