/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Expo config plugin for the Mappls map SDK (Android). The plugin that ships inside the npm package is
 * missing its build folder, so this small one does the two jobs that are needed:
 *   1. add Mappls's Maven repository (where the native map library is downloaded from),
 *   2. put your two licence files (<appId>.a.olf and <appId>.a.conf) into android/app, where the SDK's own
 *      build script looks for them.
 * It only runs for builds made with MAPPLS_ENABLED=1. The files are read from the folder named in
 * MAPPLS_CONFIG_DIR (the build workflow unpacks them there from a GitHub secret). Their contents are never printed.
 */
const fs = require('fs');
const path = require('path');
const { withProjectBuildGradle, withDangerousMod } = require('@expo/config-plugins');

const MAPPLS_REPO = "maven { url 'https://maven.mappls.com/repository/mappls/' }";

function addMapplsRepository(gradle) {
  if (gradle.includes('maven.mappls.com')) return gradle;
  const jitpack = "maven { url 'https://www.jitpack.io' }";
  if (gradle.includes(jitpack)) return gradle.replace(jitpack, `${jitpack}\n    ${MAPPLS_REPO}`);
  const block = /allprojects\s*\{\s*repositories\s*\{/;
  if (block.test(gradle)) return gradle.replace(block, (m) => `${m}\n    ${MAPPLS_REPO}`);
  throw new Error(
    'with-mappls: could not find the "allprojects { repositories {" block in android/build.gradle, so the Mappls repository was not added. The Expo template may have changed.'
  );
}

function copyLicenceFiles(androidRoot) {
  const dir = process.env.MAPPLS_CONFIG_DIR;
  if (!dir || !fs.existsSync(dir)) {
    throw new Error('with-mappls: MAPPLS_ENABLED=1 but MAPPLS_CONFIG_DIR does not point to a folder with the Mappls files.');
  }
  const names = fs.readdirSync(dir);
  const olf = names.filter((n) => n.endsWith('.a.olf'));
  const conf = names.filter((n) => n.endsWith('.a.conf'));
  if (olf.length !== 1 || conf.length !== 1) {
    throw new Error(`with-mappls: expected exactly one .a.olf and one .a.conf file, found ${olf.length} and ${conf.length}.`);
  }
  if (olf[0].replace(/\.a\.olf$/, '') !== conf[0].replace(/\.a\.conf$/, '')) {
    throw new Error('with-mappls: the .a.olf and .a.conf files do not belong together (different names).');
  }
  const target = path.join(androidRoot, 'app');
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(dir, olf[0]), path.join(target, olf[0]));
  fs.copyFileSync(path.join(dir, conf[0]), path.join(target, conf[0]));
}

module.exports = function withMappls(config) {
  config = withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('with-mappls: expected a Groovy android/build.gradle.');
    }
    cfg.modResults.contents = addMapplsRepository(cfg.modResults.contents);
    return cfg;
  });
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      copyLicenceFiles(cfg.modRequest.platformProjectRoot);
      return cfg;
    },
  ]);
  return config;
};

module.exports.addMapplsRepository = addMapplsRepository;
