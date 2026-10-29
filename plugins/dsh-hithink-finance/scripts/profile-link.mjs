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
  return { raw, eol: detectEol(raw), json: JSON.parse(raw) };
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageDir = args.packageDir
    ? resolve(args.packageDir)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..');

  const profileDir = join(dshHome(args), 'profiles', args.profile);
  const profilePath = join(profileDir, 'package.json');
  if (!existsSync(profilePath)) {
    console.error(`error: no profile manifest at ${profilePath}`);
    process.exit(1);
  }

  const { json, eol } = readProfile(profilePath);
  const dependencies = ensureObject(json, 'dependencies');
  const dsh = ensureObject(json, 'dsh');
  const profile = ensureObject(dsh, 'profile');
  if (!Array.isArray(profile.bundles)) profile.bundles = [];

  const linkSpec = `link:${packageDir.replace(/\\/g, '/')}`;
  const inBundles = profile.bundles.includes(args.name);
  const currentSpec = dependencies[args.name];

  if (args.action === 'check') {
    console.log(
      JSON.stringify(
        {
          profile: profilePath,
          dependency: currentSpec ?? null,
          expected: linkSpec,
          inBundles,
          ok: currentSpec === linkSpec && inBundles,
        },
        null,
        2,
      ),
    );
    process.exit(currentSpec === linkSpec && inBundles ? 0 : 1);
  }

  if (args.action === 'add') {
    const already = currentSpec === linkSpec && inBundles;
    dependencies[args.name] = linkSpec;
    if (!inBundles) profile.bundles.push(args.name);
    if (!already) writeProfile(profilePath, json, eol, { backup: true });
    console.log(
      JSON.stringify(
        {
          profile: profilePath,
          changed: !already,
          dependency: linkSpec,
          bundlesCount: profile.bundles.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  // remove
  let changed = false;
  if (currentSpec !== undefined) {
    delete dependencies[args.name];
    changed = true;
  }
  if (inBundles) {
    profile.bundles = profile.bundles.filter((entry) => entry !== args.name);
    changed = true;
  }
  if (changed) writeProfile(profilePath, json, eol, { backup: true });
  console.log(
    JSON.stringify(
      { profile: profilePath, changed, bundlesCount: profile.bundles.length },
      null,
      2,
    ),
  );
}

main();
