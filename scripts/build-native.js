#!/usr/bin/env node
/**
 * Build Native Extensions
 *
 * Compiles C++ native extensions for Ableton Live and REAPER.
 * Requires respective SDKs to be installed:
 *   - Ableton Extension SDK: https://www.ableton.com/en/live/extensions/
 *   - REAPER SDK: https://www.reaper.fm/sdk/plugin/plugin.php#ext_dl
 *
 * SDK paths can be set via environment variables:
 *   ABLETON_SDK_PATH
 *   REAPER_SDK_PATH
 *
 * Output: native/build/<platform>/resolvelink_ableton.{dll,dylib,so}
 *         native/build/<platform>/resolvelink.{dll,dylib,so}
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NATIVE_DIR = path.join(ROOT, 'native');
const OUT_DIR = path.join(ROOT, 'native', 'build');
const PLATFORM = process.platform;

// Detect architecture
const ARCH = process.arch === 'x64' ? 'x64' : 'arm64';

// Platform-specific output names
function getOutputNames(platform) {
  if (platform === 'win32') {
    return { ableton: 'resolvelink_ableton.dll', reaper: 'resolvelink.dll' };
  } else if (platform === 'darwin') {
    return { ableton: 'resolvelink_ableton.dylib', reaper: 'resolvelink.dylib' };
  } else {
    return { ableton: 'libresolvelink_ableton.so', reaper: 'libresolvelink.so' };
  }
}

function runCMake(extName, sourceDir, buildDir, extraArgs = []) {
  console.log(`[native] Configuring ${extName}...`);

  // Create build directory
  fs.mkdirSync(buildDir, { recursive: true });

  // Configure
  const cmakeArgs = [
    '-S', sourceDir,
    '-B', buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    ...extraArgs
  ];

  const configResult = spawnSync('cmake', cmakeArgs, {
    stdio: 'inherit',
    env: { ...process.env }
  });

  if (configResult.status !== 0) {
    console.error(`[native] CMake configure failed for ${extName}`);
    return false;
  }

  // Build
  console.log(`[native] Building ${extName}...`);
  const buildResult = spawnSync('cmake', ['--build', buildDir, '--config', 'Release'], {
    stdio: 'inherit',
    env: { ...process.env }
  });

  if (buildResult.status !== 0) {
    console.error(`[native] CMake build failed for ${extName}`);
    return false;
  }

  return true;
}

function findArtifact(buildDir, name) {
  // CMake outputs to build dir directly based on CMAKE_RUNTIME_OUTPUT_DIRECTORY
  const directPath = path.join(buildDir, name);
  if (fs.existsSync(directPath)) return directPath;

  // Also check common CMake subdirectories
  const candidates = [
    path.join(buildDir, 'Release', name),
    path.join(buildDir, 'Debug', name),
    path.join(buildDir, name),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function copyArtifact(src, destDir, destName) {
  if (!src || !fs.existsSync(src)) {
    console.error(`[native] Artifact not found: ${src}`);
    return false;
  }

  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, destName);
  fs.copyFileSync(src, dest);
  console.log(`[native] Copied ${path.basename(src)} -> ${dest}`);
  return true;
}

function ensureDistNativeDirs() {
  // Create dist-native/<platform>/ableton and /reaper dirs so electron-builder doesn't warn
  const platforms = ['win', 'mac', 'linux'];
  for (const p of platforms) {
    fs.mkdirSync(path.join(ROOT, 'dist-native', p, 'ableton'), { recursive: true });
    fs.mkdirSync(path.join(ROOT, 'dist-native', p, 'reaper'), { recursive: true });
  }
}

async function main() {
  const names = getOutputNames(PLATFORM);
  const outPlatformDir = path.join(OUT_DIR, PLATFORM === 'win32' ? 'win' : PLATFORM === 'darwin' ? 'mac' : 'linux');
  const extensionsOutDir = path.join(ROOT, 'dist-native', PLATFORM === 'win32' ? 'win' : PLATFORM === 'darwin' ? 'mac' : 'linux');

  // Ensure dist-native dirs exist to avoid electron-builder warnings
  ensureDistNativeDirs();

  console.log(`[native] Building for ${PLATFORM} (${ARCH})`);
  console.log(`[native] Output directory: ${outPlatformDir}`);

  let anyBuilt = false;

  // --- Ableton Extension ---
  console.log('\n[native] === Ableton Live Extension ===');
  const abletonSrc = path.join(NATIVE_DIR, 'ableton');
  const abletonBuild = path.join(OUT_DIR, 'ableton-build');

  const abletonSdkPath = process.env.ABLETON_SDK_PATH;
  if (!abletonSdkPath) {
    console.warn('[native] ABLETON_SDK_PATH not set. Skipping Ableton extension build.');
    console.warn('[native] Set ABLETON_SDK_PATH to Ableton Extension SDK path to enable.');
  } else if (!fs.existsSync(path.join(abletonSrc, 'CMakeLists.txt'))) {
    console.warn('[native] Ableton CMakeLists.txt not found. Skipping.');
  } else {
    const success = runCMake('Ableton', abletonSrc, abletonBuild, [
      `-DABLETON_SDK_PATH=${abletonSdkPath}`
    ]);

    if (success) {
      const artifact = findArtifact(abletonBuild, names.ableton);
      if (copyArtifact(artifact, extensionsOutDir, `ableton/${names.ableton}`)) {
        anyBuilt = true;
      }
    }
  }

  // --- REAPER Extension ---
  console.log('\n[native] === REAPER Extension ===');
  const reaperSrc = path.join(NATIVE_DIR, 'reaper');
  const reaperBuild = path.join(OUT_DIR, 'reaper-build');

  const reaperSdkPath = process.env.REAPER_SDK_PATH;
  if (!reaperSdkPath) {
    console.warn('[native] REAPER_SDK_PATH not set. Skipping REAPER extension build.');
    console.warn('[native] Set REAPER_SDK_PATH to REAPER SDK path to enable.');
  } else if (!fs.existsSync(path.join(reaperSrc, 'CMakeLists.txt'))) {
    console.warn('[native] REAPER CMakeLists.txt not found. Skipping.');
  } else {
    const success = runCMake('REAPER', reaperSrc, reaperBuild, [
      `-DREAPER_SDK_PATH=${reaperSdkPath}`
    ]);

    if (success) {
      const artifact = findArtifact(reaperBuild, names.reaper);
      if (copyArtifact(artifact, extensionsOutDir, `reaper/${names.reaper}`)) {
        anyBuilt = true;
      }
    }
  }

  // Summary
  console.log('\n[native] === Summary ===');
  if (anyBuilt) {
    console.log(`[native] Built artifacts in: ${extensionsOutDir}`);
    const files = fs.readdirSync(extensionsOutDir, { recursive: true });
    for (const f of files) {
      const full = path.join(extensionsOutDir, f);
      if (fs.statSync(full).isFile()) {
        const size = fs.statSync(full).size;
        console.log(`  ${f} (${(size/1024).toFixed(1)} KB)`);
      }
    }
  } else {
    console.log('[native] No native extensions built (SDKs not available)');
  }

  // Exit with success even if nothing built (SDKs optional)
  process.exit(0);
}

main().catch(err => {
  console.error('[native] Fatal error:', err);
  process.exit(1);
});