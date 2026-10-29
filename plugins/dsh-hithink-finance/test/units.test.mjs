import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig, enabledDomains, DEFAULTS } from '../lib/config.js';
import { normalizeThsCode, normalizeThsCodeList, exchangeFor } from '../lib/thscode.js';
import { resolveApiKey, readCredentialFile, redact } from '../lib/credentials.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('config: empty input yields defaults', () => {
  const config = normalizeConfig(undefined);
  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, 'https://fuyao.aicubes.cn');
  assert.deepEqual(config.domains, DEFAULTS.domains);
  assert.deepEqual(enabledDomains(config), ['core', 'special']);
});

test('config: trailing slash on baseUrl is stripped', () => {
  assert.equal(normalizeConfig({ baseUrl: 'https://x.test//' }).baseUrl, 'https://x.test');
});

test('config: integers are clamped, garbage falls back', () => {
  assert.equal(normalizeConfig({ spillRows: 0 }).spillRows, 1);
  assert.equal(normalizeConfig({ spillRows: 1e9 }).spillRows, 100000);
  assert.equal(normalizeConfig({ timeoutMs: 'abc' }).timeoutMs, DEFAULTS.timeoutMs);
  assert.equal(normalizeConfig({ maxRetries: 99 }).maxRetries, 5);
});

test('config: domain flags accept strings and unknown keys are ignored', () => {
  const config = normalizeConfig({ domains: { fund: 'true', nope: true } });
  assert.equal(config.domains.fund, true);
  assert.equal('nope' in config.domains, false);
});

test('thscode: canonical passes through', () => {
  assert.deepEqual(normalizeThsCode('600519.SH'), { ok: true, thscode: '600519.SH', changed: false });
});

test('thscode: prefix form is flipped', () => {
  assert.equal(normalizeThsCode('sh600519').thscode, '600519.SH');
  assert.equal(normalizeThsCode('SZ000001').thscode, '000001.SZ');
});

test('thscode: bare codes map to the right exchange', () => {
  assert.equal(normalizeThsCode('600519').thscode, '600519.SH');
  assert.equal(normalizeThsCode('900901').thscode, '900901.SH');
  assert.equal(normalizeThsCode('000001').thscode, '000001.SZ');
  assert.equal(normalizeThsCode('300750').thscode, '300750.SZ');
  assert.equal(normalizeThsCode('920002').thscode, '920002.BJ');
  assert.equal(normalizeThsCode('830799').thscode, '830799.BJ');
});

test('thscode: a company name is refused, never guessed', () => {
  const result = normalizeThsCode('璐靛窞鑼呭彴');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_a_code');
});

test('thscode: unknown suffix is refused', () => {
  assert.equal(normalizeThsCode('600519.SS').ok, false);
  assert.equal(normalizeThsCode('00700.HK').ok, false);
  assert.equal(normalizeThsCode('   ').reason, 'empty');
});

test('thscode: list keeps order, dedupes, reports rejects', () => {
  const { thscodes, rejected } = normalizeThsCodeList(['600519', '000001.SZ', '600519.SH', '鑼呭彴', '']);
  assert.deepEqual(thscodes, ['600519.SH', '000001.SZ']);
  assert.deepEqual(rejected, ['鑼呭彴']);
});

test('exchangeFor: numeric ranges', () => {
  assert.equal(exchangeFor('688981'), 'SH');
  assert.equal(exchangeFor('430047'), 'BJ');
  assert.equal(exchangeFor('159915'), 'SZ');
});

test('credentials: explicit config wins', () => {
  const resolved = resolveApiKey({
    config: { apiKey: 'from-config', apiKeyEnv: 'HITHINK_FINANCE_API_KEY' },
    env: { HITHINK_FINANCE_API_KEY: 'from-env' },
  });
  assert.equal(resolved.source, 'config');
  assert.equal(resolved.key, 'from-config');
});

test('credentials: env beats file, legacy is last', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hithink-'));
  // The reader looks for <root>/hithink-finance/credentials.env, not <root>/credentials.env.
  const credentialDir = join(dir, 'hithink-finance');
  mkdirSync(credentialDir, { recursive: true });
  const file = join(credentialDir, 'credentials.env');
  writeFileSync(file, 'HITHINK_FINANCE_API_KEY=from-file\n', 'utf8');
  assert.equal(readCredentialFile(file).key, 'from-file');

  const fromEnv = resolveApiKey({
    config: {},
    env: { HITHINK_FINANCE_API_KEY: 'from-env', DSH_HOME: dir },
    dshHome: dir,
  });
  assert.equal(fromEnv.source, 'env:HITHINK_FINANCE_API_KEY');

  const fromFile = resolveApiKey({ config: {}, env: { DSH_HOME: dir }, dshHome: dir });
  assert.equal(fromFile.key, 'from-file');

  // Legacy names are the last resort: only reachable when no file exists either.
  const legacy = resolveApiKey({
    config: {},
    env: { FUYAO_TOKEN: 'legacy' },
    dshHome: mkdtempSync(join(tmpdir(), 'hithink-empty-')),
  });
  assert.equal(legacy.source, 'legacy-env:FUYAO_TOKEN');
});

test('credentials: a quoted value is refused, not silently accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hithink-'));
  const file = join(dir, 'credentials.env');
  writeFileSync(file, 'HITHINK_FINANCE_API_KEY="quoted"\n', 'utf8');
  const { key, error } = readCredentialFile(file);
  assert.equal(key, null);
  assert.match(error, /quoted/);
});

test('credentials: nothing found reports source none and keeps no key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hithink-'));
  const resolved = resolveApiKey({ config: {}, env: { DSH_HOME: dir }, dshHome: dir });
  assert.equal(resolved.key, null);
  assert.equal(resolved.source, 'none');
});

test('redact: strips the secret everywhere it appears', () => {
  const text = 'key=abcd1234 and again abcd1234';
  assert.equal(redact(text, 'abcd1234'), 'key=*** and again ***');
  assert.equal(redact(text, ''), text);
  assert.equal(redact('abc', 'abc'), 'abc'); // too short to be a real key
});

