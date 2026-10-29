#!/usr/bin/env node
/**
 * Link this package into a DSH profile, editing only the two places DSH reads:
 *
 *   dependencies["<name>"]              = "link:<abs path>"
 *   dsh.profile.bundles                 += "<name>"
 *
 * Kept in Node rather than PowerShell on purpose: JSON.stringify preserves the
 * original key order, and we avoid PowerShell's UTF-8 / BOM / CRLF traps on a
 * file that DSH rewrites. The caller (install.ps1) owns the junction.
 *
 * Usage:
 *   node scripts/profile-link.mjs --profile desktop --action add|remove|check
 *        [--dsh-home <dir>] [--name <pkg>] [--package <abs dir>]
 *
 * Exit codes: 0 ok, 1 failure, 2 bad usage.
 */

import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_NAME = 'dsh-hithink-finance';

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(
    'usage: profile-link.mjs --profile <name> --action add|remove|check ' +
      '[--dsh-home <dir>] [--name <pkg>] [--package <abs dir>]',
  );
  process.exit(2);
}

function parseArgs(argv) {
  const args = { action: '', profile: '', dshHome: '', name: DEFAULT_NAME, packageDir: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--action':
        args.action = value ?? '';
        index += 1;
        break;
      case '--profile':
        args.profile = value ?? '';
        index += 1;
        break;
      case '--dsh-home':
        args.dshHome = value ?? '';
        index += 1;
        break;
      case '--name':
        args.name = value ?? DEFAULT_NAME;
        index += 1;
        break;
      case '--package':
        args.packageDir = value ?? '';
        index += 1;
        break;
      default:
        usage(`unknown argument: ${flag}`);
    }
  }
  if (!['add', 'remove', 'check'].includes(args.action)) usage('--action is required');
  if (!args.profile) usage('--profile is required');
  return args;
}

function dshHome(args) {
  if (args.dshHome) return resolve(args.dshHome);
  const fromEnv = String(process.env.DSH_HOME ?? '').trim();
  return fromEnv === '' ? join(homedir(), '.dsh') : resolve(fromEnv);
}

function detectEol(raw) {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

function readProfile(path) {
  const raw = readFileSync(path, 'utf8');
  // A BOM survives readFileSync and makes JSON.parse throw a message that says
  // nothing about the real cause, so strip it explicitly.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    console.error(`error: ${path} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  return { raw, eol: detectEol(text), trailing: text.endsWith('\n'), json };
}

function writeProfile(path, json, eol, { backup, trailing = true }) {
  if (backup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(path, `${path}.bak-hithink-${stamp}`);
  }
  // JSON.stringify only ever emits "\n"; converting the whole document keeps a
  // CRLF manifest from becoming half-CRLF, half-LF. The trailing newline is
  // carried over only if the original had one, so a round trip is byte-exact.
  const body = JSON.stringify(json, null, 2).split('\n').join(eol);
  writeFileSync(path, trailing ? body + eol : body, 'utf8');
}

function ensureObject(parent, key) {
  if (parent[key] === null || typeof parent[key] !== 'object' || Array.isArray(parent[key])) {
    parent[key] = {};
  }
  return parent[key];
}

/**
 * Shape of the manifest as it was BEFORE our first add, reconstructed from the
 * newest backup we wrote at that moment.
 *
 * `remove` runs in a fresh process, so it cannot remember what it created. The
 * backup is already on disk and is exactly that record, so we read it instead of
 * inventing a sidecar state file.
 *
 * @param {string} profilePath
 * @returns {{ dependencies: boolean, dsh: boolean, profile: boolean, bundles: boolean } | null}
 */
function shapeFromNewestBackup(profilePath) {
  try {
    const dir = dirname(profilePath);
    const base = basename(profilePath);
    const backups = readdirSync(dir)
      .filter((entry) => entry.startsWith(`${base}.bak-hithink-`))
      .sort();
    if (backups.length === 0) return null;
    const raw = readFileSync(join(dir, backups[backups.length - 1]), 'utf8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const json = JSON.parse(text);
    return {
      dependencies: Object.prototype.hasOwnProperty.call(json, 'dependencies'),
      dsh: Object.prototype.hasOwnProperty.call(json, 'dsh'),
      profile: Boolean(json.dsh) && Object.prototype.hasOwnProperty.call(json.dsh, 'profile'),
      bundles: Boolean(json.dsh?.profile) && Object.prototype.hasOwnProperty.call(json.dsh.profile, 'bundles'),
    };
  } catch {
    return null;
  }
}

/**
 * Apply one action to a profile manifest.
 *
 * Exported so the test suite can drive it without spawning a child process
 * (the sandbox refuses piped stdio, and a unit test should not need a shell).
 *
 * @param {{
 *   action: 'add' | 'remove' | 'check',
 *   profile: string,
 *   dshHome: string,
 *   name: string,
 *   packageDir: string,
 * }} options
 * @returns {{ report: object, exitCode: number }}
 */
export function linkProfile(options) {
  const packageDir = resolve(options.packageDir);
  const profilePath = join(resolve(options.dshHome), 'profiles', options.profile, 'package.json');
  if (!existsSync(profilePath)) {
    throw new Error(`no profile manifest at ${profilePath}`);
  }

  const { json, eol, trailing } = readProfile(profilePath);

  // Remember which containers existed before we touch anything. `remove` uses
  // this to delete the ones we created ourselves -- otherwise an uninstall
  // leaves behind `"dependencies": {}` and the manifest is no longer identical
  // to the pre-install file.
  const shape = {
    dependencies: Object.prototype.hasOwnProperty.call(json, 'dependencies'),
    dsh: Object.prototype.hasOwnProperty.call(json, 'dsh'),
    profile: Boolean(json.dsh) && Object.prototype.hasOwnProperty.call(json.dsh, 'profile'),
    bundles: Boolean(json.dsh?.profile) && Object.prototype.hasOwnProperty.call(json.dsh.profile, 'bundles'),
  };

  const dependencies = ensureObject(json, 'dependencies');
  const dsh = ensureObject(json, 'dsh');
  const profile = ensureObject(dsh, 'profile');
  if (!Array.isArray(profile.bundles)) profile.bundles = [];

  const linkSpec = `link:${packageDir.replace(/\\/g, '/')}`;
  const inBundles = profile.bundles.includes(options.name);
  const currentSpec = dependencies[options.name];

  if (options.action === 'check') {
    const ok = currentSpec === linkSpec && inBundles;
    return {
      report: { profile: profilePath, dependency: currentSpec ?? null, expected: linkSpec, inBundles, ok },
      exitCode: ok ? 0 : 1,
    };
  }

  if (options.action === 'add') {
    const already = currentSpec === linkSpec && inBundles;
    // Report what is being replaced: a published version, another checkout, or
    // nothing. Silently overwriting a pinned version would be rude.
    const previous = currentSpec === undefined ? null : currentSpec;
    dependencies[options.name] = linkSpec;
    if (!inBundles) profile.bundles.push(options.name);
    if (!already) writeProfile(profilePath, json, eol, { backup: true, trailing });
    return {
      report: {
        profile: profilePath,
        changed: !already,
        previous,
        dependency: linkSpec,
        bundlesCount: profile.bundles.length,
      },
      exitCode: 0,
    };
  }

  if (options.action !== 'remove') throw new Error(`unknown action: ${options.action}`);

  let changed = false;
  if (currentSpec !== undefined) {
    delete dependencies[options.name];
    changed = true;
  }
  if (inBundles) {
    profile.bundles = profile.bundles.filter((entry) => entry !== options.name);
    changed = true;
  }

  // Drop containers the ADD created. The in-memory shape is not enough here: on
  // remove the file already contains what add wrote, so the pre-install shape has
  // to come from the backup taken at add time.
  const origin = shapeFromNewestBackup(profilePath) ?? shape;
  if (!origin.dependencies && Object.keys(dependencies).length === 0) {
    delete json.dependencies;
    changed = true;
  }
  if (!origin.bundles && profile.bundles.length === 0) {
    delete profile.bundles;
    changed = true;
  }
  if (!origin.profile && Object.keys(profile).length === 0) {
    delete dsh.profile;
    changed = true;
  }
  if (!origin.dsh && Object.keys(dsh).length === 0) {
    delete json.dsh;
    changed = true;
  }

  if (changed) writeProfile(profilePath, json, eol, { backup: true, trailing });
  return {
    report: { profile: profilePath, changed, bundlesCount: profile.bundles?.length ?? 0 },
    exitCode: 0,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = linkProfile({
    action: args.action,
    profile: args.profile,
    dshHome: dshHome(args),
    name: args.name,
    packageDir: args.packageDir
      ? resolve(args.packageDir)
      : resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  });
  console.log(JSON.stringify(result.report, null, 2));
  process.exit(result.exitCode);
}

// Only run when invoked directly, so tests can import linkProfile().
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
