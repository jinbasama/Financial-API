/**
 * API key resolution and redaction.
 *
 * Resolution order mirrors upstream (hithink-finance-cli `ApiKeyAuthProvider`
 * and python/marketdb/credentials.py, both MIT):
 *
 *   1. config.apiKey
 *   2. process.env[config.apiKeyEnv]           (default HITHINK_FINANCE_API_KEY)
 *   3. $DSH_HOME/hithink-finance/credentials.env
 *   4. %APPDATA%\hithink-finance\credentials.env   (upstream location, Windows)
 *   5. legacy env: FUYAO_TOKEN / API_KEY
 *   6. none -> AUTH_MISSING with the admin URL
 *
 * The credential file holds exactly one non-comment line, `KEY=value`, and the
 * value must NOT be quoted -- upstream rejects quoted values, so we do too.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CANONICAL_ENV = 'HITHINK_FINANCE_API_KEY';
export const LEGACY_ENVS = ['FUYAO_TOKEN', 'API_KEY'];
export const ADMIN_URL = 'https://fuyao.aicubes.cn/admin/';

const CREDENTIAL_DIR = 'hithink-finance';
const CREDENTIAL_FILE = 'credentials.env';

/**
 * All credential-file locations we will look at, most specific first.
 *
 * @param {{ dshHome?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {string[]}
 */
export function credentialFileCandidates(options = {}) {
  const env = options.env ?? process.env;
  const dshHome = options.dshHome ?? (env.DSH_HOME || join(homedir(), '.dsh'));
  const candidates = [join(dshHome, CREDENTIAL_DIR, CREDENTIAL_FILE)];

  const appData = (env.APPDATA ?? '').trim();
  if (appData !== '') candidates.push(join(appData, CREDENTIAL_DIR, CREDENTIAL_FILE));

  return candidates;
}

/**
 * Read `HITHINK_FINANCE_API_KEY` out of an upstream-style credentials.env file.
 *
 * @param {string} path
 * @returns {{ key: string | null, error: string | null }}
 */
export function readCredentialFile(path) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    return { key: null, error: `unreadable (${error?.code ?? 'unknown'})` };
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const name = line.slice(0, index).trim();
    if (name !== CANONICAL_ENV) continue;
    const value = line.slice(index + 1).trim();
    if (value.includes("'") || value.includes('"')) {
      return { key: null, error: 'value must not be quoted' };
    }
    return value === '' ? { key: null, error: 'empty value' } : { key: value, error: null };
  }
  return { key: null, error: 'no HITHINK_FINANCE_API_KEY line' };
}

/**
 * Resolve the API key without ever throwing.
 *
 * @param {{
 *   config: { apiKey?: string, apiKeyEnv?: string },
 *   env?: Record<string, string | undefined>,
 *   dshHome?: string,
 * }} options
 * @returns {{ key: string, source: string, notes: string[] }
 *   | { key: null, source: 'none', notes: string[] }}
 */
export function resolveApiKey(options) {
  const config = options.config ?? {};
  const env = options.env ?? process.env;
  const notes = [];

  const explicit = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (explicit !== '') return { key: explicit, source: 'config', notes };

  const envName = (config.apiKeyEnv ?? '').trim() || CANONICAL_ENV;
  const fromEnv = (env[envName] ?? '').trim();
  if (fromEnv !== '') return { key: fromEnv, source: `env:${envName}`, notes };

  for (const path of credentialFileCandidates({ dshHome: options.dshHome, env })) {
    if (!existsSync(path)) continue;
    const { key, error } = readCredentialFile(path);
    if (key !== null) return { key, source: `file:${path}`, notes };
    notes.push(`${path}: ${error}`);
  }

  for (const legacy of LEGACY_ENVS) {
    const value = (env[legacy] ?? '').trim();
    if (value !== '') return { key: value, source: `legacy-env:${legacy}`, notes };
  }

  return { key: null, source: 'none', notes };
}

/**
 * Strip a secret out of any text we are about to hand to the model or a log.
 *
 * Defensive on purpose: callers pass whatever they have, including null.
 *
 * @param {unknown} value
 * @param {string | null | undefined} secret
 * @returns {string}
 */
export function redact(value, secret) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const needle = typeof secret === 'string' ? secret.trim() : '';
  if (needle.length < 4) return text;
  return text.split(needle).join('***');
}

/** Human copy for the "no key" case, reused by every tool and by doctor. */
export const AUTH_MISSING_HINT =
  `No API key found. Sign in to ${ADMIN_URL} with your 同花顺 account ` +
  `(keep the trailing slash -- without it the page downgrades to HTTP and the ` +
  `login state is lost), create an API key, then either set ` +
  `HITHINK_FINANCE_API_KEY or write it to %DSH_HOME%\\hithink-finance\\credentials.env ` +
  `as a single line: HITHINK_FINANCE_API_KEY=<key>`;
