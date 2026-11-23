import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {access, copyFile, mkdir, mkdtemp, readFile, rename, rm} from 'node:fs/promises';

const manifestDir = fileURLToPath(new URL('../scripts/hyperframes-runtime/', import.meta.url));
const cliFile = path.join('node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
const gsapFile = path.join('node_modules', 'gsap', 'dist', 'gsap.min.js');

async function configuration(localAppData) {
  if (!localAppData) throw new Error('HYPERFRAMES_WINDOWS_CACHE_REQUIRED');
  const [manifest, lock] = await Promise.all([
    readFile(path.join(manifestDir, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(manifestDir, 'package-lock.json')),
  ]);
  const parent = path.join(localAppData, 'GeminiNarrationStudio', 'runtime', 'hyperframes');
  const version = manifest.dependencies.hyperframes;
  const lockHash = createHash('sha256').update(lock).digest('hex').slice(0, 12);
  return {parent, root: path.join(parent, version + '-' + lockHash), version, gsapVersion: manifest.dependencies.gsap};
}

async function installed({root, version, gsapVersion}) {
  try {
    const modules = path.join(root, 'node_modules');
    const [hyperframes, gsap] = await Promise.all([
      readFile(path.join(modules, 'hyperframes', 'package.json'), 'utf8').then(JSON.parse),
      readFile(path.join(modules, 'gsap', 'package.json'), 'utf8').then(JSON.parse),
      access(path.join(root, cliFile)),
      access(path.join(root, gsapFile)),
    ]);
    if (hyperframes.version === version && gsap.version === gsapVersion) {
      return {cli: path.join(root, cliFile), gsap: path.join(root, gsapFile), version};
    }
  } catch {}
  return null;
}

export async function hyperframesInstallation(localAppData = process.env.LOCALAPPDATA) {
  if (!localAppData) return null;
  const config = await configuration(localAppData);
  const runtime = await installed(config);
  if (!runtime) return null;
  const bin = path.join(config.parent, 'ffmpeg-8.1.2-essentials_build', 'bin');
  const ffmpeg = path.join(bin, 'ffmpeg.exe');
  const ffprobe = path.join(bin, 'ffprobe.exe');
  try {
    await Promise.all([access(ffmpeg), access(ffprobe)]);
    return {...runtime, ffmpeg, ffprobe};
  } catch {
    return null;
  }
}

export async function ensureHyperframes(runNode, localAppData = process.env.LOCALAPPDATA) {
  const config = await configuration(localAppData);
  const ready = await installed(config);
  if (ready) return {...ready, reused: true};
  await mkdir(config.parent, {recursive: true});
  const stage = await mkdtemp(path.join(config.parent, '.install-'));
  try {
    await Promise.all(['package.json', 'package-lock.json'].map(name => copyFile(path.join(manifestDir, name), path.join(stage, name))));
    const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await runNode(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], stage);
    if (!await installed({...config, root: stage})) throw new Error('HYPERFRAMES_INSTALL_VERIFICATION_FAILED');
    try {
      await rename(stage, config.root);
    } catch (error) {
      const other = await installed(config);
      if (other) return {...other, reused: true};
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      throw new Error('HYPERFRAMES_INCOMPLETE_CACHE');
    }
    return {...await installed(config), reused: false};
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
}
