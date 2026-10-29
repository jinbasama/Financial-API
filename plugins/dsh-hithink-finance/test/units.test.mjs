import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig, enabledDomains, DEFAULTS } from '../lib/config.js';
import { normalizeThsCode, normalizeThsCodeList, exchangeFor } from '../lib/thscode.js';
import { resolveApiKey, readCredentialFile, credentialFileCandidates, redact } from '../lib/credentials.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

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

test('thscode: bare stock codes map to the right exchange', () => {
  assert.equal(normalizeThsCode('600519').thscode, '600519.SH');
  assert.equal(normalizeThsCode('688981').thscode, '688981.SH');
  assert.equal(normalizeThsCode('900901').thscode, '900901.SH');
  assert.equal(normalizeThsCode('000001').thscode, '000001.SZ');
  assert.equal(normalizeThsCode('300750').thscode, '300750.SZ');
  assert.equal(normalizeThsCode('920002').thscode, '920002.BJ');
  assert.equal(normalizeThsCode('830799').thscode, '830799.BJ');
  assert.equal(normalizeThsCode('430047').thscode, '430047.BJ');
});

test('thscode: a company name is refused, never guessed', () => {
  const result = normalizeThsCode('贵州茅台');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_a_code');
});

test('thscode: unknown suffix is refused', () => {
  assert.equal(normalizeThsCode('600519.SS').ok, false);
  assert.equal(normalizeThsCode('00700.HK').ok, false);
  assert.equal(normalizeThsCode('   ').reason, 'empty');
});

test('thscode: list keeps order, dedupes, reports rejects', () => {
  const { thscodes, rejected } = normalizeThsCodeList(['600519', '000001.SZ', '600519.SH', '贵州茅台', '']);
  assert.deepEqual(thscodes, ['600519.SH', '000001.SZ']);
  assert.deepEqual(rejected, [{ input: '贵州茅台', reason: 'not_a_code' }]);
});

test('exchangeFor: only unambiguous stock ranges are inferred', () => {
  assert.equal(exchangeFor('688981'), 'SH');
  assert.equal(exchangeFor('600519'), 'SH');
  assert.equal(exchangeFor('900901'), 'SH');
  assert.equal(exchangeFor('000001'), 'SZ');
  assert.equal(exchangeFor('300750'), 'SZ');
  assert.equal(exchangeFor('200002'), 'SZ');
  assert.equal(exchangeFor('430047'), 'BJ');
  assert.equal(exchangeFor('920002'), 'BJ');
});

// --- regressions found during the M0 audit -------------------------------

test('thscode: inner whitespace is not spliced into a code', () => {
  // "600 519" must not become 600519.SH: silently repairing broken input hides
  // a caller bug and can resolve to the wrong listed company.
  assert.equal(normalizeThsCode('600 519').ok, false);
  assert.equal(normalizeThsCode('600519 .SH').ok, false);
  assert.equal(normalizeThsCode(' 600519 ').thscode, '600519.SH');
});

test('thscode: funds, bonds and the old NEEQ board are refused, not guessed', () => {
  // The first version had a catch-all `-> SZ`, which mapped a Shanghai ETF
  // (510300) and a Shanghai convertible bond (110038) to Shenzhen: a
  // valid-looking but wrong symbol. Refusing is the correct behaviour.
  for (const code of ['510300', '159915', '110038', '400001', '500001']) {
    const result = normalizeThsCode(code);
    assert.equal(result.ok, false, `${code} must not be assumed`);
    assert.equal(result.reason, 'ambiguous_exchange', code);
  }
});

test('thscode: an explicit suffix still works for a non-stock symbol', () => {
  // 510300.SH is unambiguous once the caller states the exchange.
  assert.deepEqual(normalizeThsCode('510300.SH'), { ok: true, thscode: '510300.SH', changed: false });
  assert.equal(normalizeThsCode('sh510300').thscode, '510300.SH');
});

test('credentials: a UTF-8 BOM does not hide the key line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hithink-bom-'));
  const file = join(dir, 'credentials.env');
  writeFileSync(file, '\uFEFFHITHINK_FINANCE_API_KEY=bom-key-123\n', 'utf8');
  assert.equal(readCredentialFile(file).key, 'bom-key-123');
});

test('credentials: a blank dshHome does not become a relative path', () => {
  const candidates = credentialFileCandidates({ dshHome: '   ', env: { DSH_HOME: '   ' } });
  assert.equal(candidates[0].includes('hithink-finance'), true);
  assert.equal(isAbsolute(candidates[0]), true, candidates[0]);
});

test('config: an unusable baseUrl falls back instead of producing a broken URL', () => {
  assert.equal(normalizeConfig({ baseUrl: 'https://' }).baseUrl, DEFAULTS.baseUrl);
  assert.equal(normalizeConfig({ baseUrl: 'ftp://x.test' }).baseUrl, DEFAULTS.baseUrl);
  assert.equal(normalizeConfig({ baseUrl: 'not a url' }).baseUrl, DEFAULTS.baseUrl);
  assert.equal(normalizeConfig({ baseUrl: 'http://127.0.0.1:8080/' }).baseUrl, 'http://127.0.0.1:8080');
});

// --- credentials ---------------------------------------------------------

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

// --- regressions from the independent review (2026-10-29) -----------------

test('credentials: a prototype-chain name cannot crash resolution', () => {
  // `env['constructor']` resolves to a function through the prototype chain.
  // The first version called .trim() on it, threw a TypeError, and apply()'s
  // catch swallowed it: zero tools, zero warnings.
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const resolved = resolveApiKey({
      config: { apiKeyEnv: name },
      env: {},
      dshHome: mkdtempSync(join(tmpdir(), 'hithink-empty-')),
    });
    assert.equal(resolved.key, null, name);
    assert.equal(resolved.source, 'none', name);
  }

  // A value that is not even a variable name is ignored with a note.
  const invalid = resolveApiKey({
    config: { apiKeyEnv: 'not a name' },
    env: {},
    dshHome: mkdtempSync(join(tmpdir(), 'hithink-empty-')),
  });
  assert.equal(invalid.key, null);
  assert.equal(invalid.notes.length, 1);
  assert.match(invalid.notes[0], /not a valid variable name/);
});

test('credentials: the %APPDATA% fallback is actually read', () => {
  const appData = mkdtempSync(join(tmpdir(), 'hithink-appdata-'));
  mkdirSync(join(appData, 'hithink-finance'), { recursive: true });
  writeFileSync(
    join(appData, 'hithink-finance', 'credentials.env'),
    'HITHINK_FINANCE_API_KEY=from-appdata\n',
    'utf8',
  );
  const resolved = resolveApiKey({
    config: {},
    env: { APPDATA: appData, DSH_HOME: mkdtempSync(join(tmpdir(), 'hithink-dsh-')) },
    dshHome: mkdtempSync(join(tmpdir(), 'hithink-dsh2-')),
  });
  assert.equal(resolved.key, 'from-appdata');
  assert.match(resolved.source, /^file:.*hithink-finance/);
});

test('credentials: a generic API_KEY is never adopted', () => {
  // Another tool's key must not be sent to this API as X-api-key.
  const resolved = resolveApiKey({
    config: {},
    env: { API_KEY: 'sk-some-other-service' },
    dshHome: mkdtempSync(join(tmpdir(), 'hithink-empty-')),
  });
  assert.equal(resolved.key, null);
  assert.equal(resolved.source, 'none');
});

test('config: numeric 0 and 1 behave as booleans', () => {
  assert.equal(normalizeConfig({ enabled: 0 }).enabled, false);
  assert.equal(normalizeConfig({ enabled: 1 }).enabled, true);
  assert.equal(normalizeConfig({ domains: { fund: 1 } }).domains.fund, true);
  assert.equal(normalizeConfig({ domains: { core: 0 } }).domains.core, false);
  assert.equal(normalizeConfig({ enabled: 2 }).enabled, true, 'unknown numbers fall back');
});

test('config: baseUrl must be an origin, and http only on loopback', () => {
  for (const bad of [
    'https://x.test/api',
    'https://x.test/?token=1',
    'https://x.test/#frag',
    'https://user:pw@x.test',
    'http://x.test',
  ]) {
    assert.equal(normalizeConfig({ baseUrl: bad }).baseUrl, DEFAULTS.baseUrl, bad);
  }
  assert.equal(normalizeConfig({ baseUrl: 'http://127.0.0.1:7891' }).baseUrl, 'http://127.0.0.1:7891');
  assert.equal(normalizeConfig({ baseUrl: 'http://localhost:8080' }).baseUrl, 'http://localhost:8080');
});

test('thscode: a non-string input is not reported as empty', () => {
  const single = normalizeThsCode(600519);
  assert.equal(single.ok, false);
  assert.equal(single.reason, 'not_a_code');
  const list = normalizeThsCodeList([600519]);
  assert.deepEqual(list.rejected, [{ input: '600519', reason: 'not_a_code' }]);
});
