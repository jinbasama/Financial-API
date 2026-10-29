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

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  return { raw, eol: detectEol(text), json };
}

function writeProfile(path, json, eol, { backup }) {
  if (backup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(path, `${path}.bak-hithink-${stamp}`);
  }
  const text = JSON.stringify(json, null, 2) + (eol === '\r\n' ? '\r\n' : '\n');
  writeFileSync(path, text, 'utf8');
}

function ensureObject(parent, key) {
  if (parent[key] === null || typeof parent[key] !== 'object' || Array.isArray(parent[key])) {
    parent[key] = {};
  }
  return parent[key];
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

  const { json, eol } = readProfile(profilePath);
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
    if (!already) writeProfile(profilePath, json, eol, { backup: true });
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
  if (changed) writeProfile(profilePath, json, eol, { backup: true });
  return {
    report: { profile: profilePath, changed, bundlesCount: profile.bundles.length },
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
