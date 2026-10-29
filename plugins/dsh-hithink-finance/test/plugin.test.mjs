import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, selectTools } from '../lib/index.js';
import { normalizeConfig } from '../lib/config.js';

/**
 * Run `fn` with every credential source pointed at a throwaway directory, so a
 * developer machine that happens to have a real key cannot change the outcome.
 */
function withCleanEnv(fn) {
  const saved = {
    HITHINK_FINANCE_API_KEY: process.env.HITHINK_FINANCE_API_KEY,
    FUYAO_TOKEN: process.env.FUYAO_TOKEN,
    API_KEY: process.env.API_KEY,
    DSH_HOME: process.env.DSH_HOME,
    APPDATA: process.env.APPDATA,
  };
  const scratch = mkdtempSync(join(tmpdir(), 'hithink-plugin-'));
  process.env.DSH_HOME = scratch;
  process.env.APPDATA = '';
  delete process.env.HITHINK_FINANCE_API_KEY;
  delete process.env.FUYAO_TOKEN;
  delete process.env.API_KEY;
  try {
    return fn(scratch);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Minimal stand-in for the host cordis context that also enforces the host's
 * registration contract, so a malformed tool definition fails the test instead
 * of passing silently. */
function fakeContext() {
  const registered = [];
  const warnings = [];
  const ctx = {
    logger: () => ({ warn: (message) => warnings.push(message) }),
    inject: (services, callback) => {
      assert.deepEqual(services, ['tools']);
      callback({
        tools: {
          register: (definition) => {
            assert.equal(typeof definition.name, 'string');
            assert.ok(definition.name.length > 0, 'name must not be empty');
            assert.equal(typeof definition.description, 'string');
            assert.ok(definition.description.length > 0, 'description must not be empty');
            assert.equal(typeof definition.parameters, 'object');
            assert.equal(definition.parameters.type, 'object');
            assert.equal(typeof definition.output, 'object');
            assert.equal(typeof definition.output.schema, 'object');
            assert.equal(typeof definition.output.render, 'function');
            assert.equal(typeof definition.execute, 'function');
            registered.push(definition);
            return () => {};
          },
        },
        on: () => {},
      });
    },
  };
  return { ctx, registered, warnings };
}

test('apply registers exactly the doctor tool in M0', () => {
  withCleanEnv(() => {
    const { ctx, registered, warnings } = fakeContext();
    apply(ctx, undefined);
    assert.deepEqual(registered.map((tool) => tool.name), ['hithink_doctor']);
    assert.equal(warnings.length, 1, 'missing key is warned exactly once');
    assert.match(warnings[0], /no API key resolved/);
  });
});

test('apply is silent when a key exists', () => {
  withCleanEnv(() => {
    const { ctx, registered, warnings } = fakeContext();
    apply(ctx, { apiKey: 'sk-test-123456' });
    assert.equal(registered.length, 1);
    assert.deepEqual(warnings, []);
  });
});

test('apply registers nothing when disabled', () => {
  withCleanEnv(() => {
    const { ctx, registered } = fakeContext();
    apply(ctx, { enabled: false });
    assert.deepEqual(registered, []);
  });
});

test('apply never throws, even with a hostile config or context', () => {
  withCleanEnv(() => {
    // No logger on the context means apply() falls back to console.warn; capture
    // it so the test run stays clean and the fallback is asserted.
    const written = [];
    const original = console.warn;
    console.warn = (message) => written.push(String(message));
    try {
      assert.doesNotThrow(() => apply(undefined, undefined));
      assert.doesNotThrow(() => apply(null, null));
      assert.doesNotThrow(() => apply({ inject: () => { throw new Error('boom'); } }, {}));
      assert.doesNotThrow(() => apply({ logger: () => { throw new Error('boom'); } }, {}));
      assert.doesNotThrow(() => apply({ inject: (s, cb) => cb({ tools: {} }) }, {}));
    } finally {
      console.warn = original;
    }
    assert.ok(written.length > 0, 'the console fallback must have been used');
    assert.ok(written.every((line) => line.startsWith('[dsh-hithink-finance]')));
  });
});

test('one apply registers each tool id once', () => {
  withCleanEnv(() => {
    const { ctx, registered } = fakeContext();
    apply(ctx, { apiKey: 'sk-test-123456', domains: { core: true } });

    const names = registered.map((tool) => tool.name);
    assert.deepEqual(names, ['hithink_doctor']);
    assert.equal(new Set(names).size, names.length, 'no id may repeat within one apply');
  });
});

test('two applies produce two registrations, one per apply', () => {
  // The host may re-apply a plugin (reload). Each apply owns its own state, so
  // each registers its own set; the `seen` guard inside registerTools keeps a
  // single apply from registering the same id twice once M1 adds more tools.
  withCleanEnv(() => {
    const { ctx, registered } = fakeContext();
    apply(ctx, { apiKey: 'sk-test-123456' });
    apply(ctx, { apiKey: 'sk-test-123456' });
    assert.equal(registered.length, 2);
  });
});

test('selectTools: doctor is unconditional, domain tools need their switch', () => {
  const off = normalizeConfig({ domains: { core: false, fund: false } });
  assert.deepEqual(selectTools(off).map((tool) => tool.id), ['hithink_doctor']);
  assert.deepEqual(selectTools({ enabled: false }), []);
});

test('the doctor tool reports where it looked, never the key', () => {
  withCleanEnv((scratch) => {
    const { ctx, registered } = fakeContext();
    apply(ctx, { apiKey: 'sk-secret-value', domains: { fund: true } });
    const doctor = registered[0];
    const report = doctor.execute({});

    assert.equal(report.ok, true);
    assert.equal(report.auth.configured, true);
    assert.equal(report.auth.source, 'config');
    assert.ok(Array.isArray(report.auth.credentialFiles));
    assert.equal(report.auth.credentialFiles[0], join(scratch, 'hithink-finance', 'credentials.env'));
    assert.ok(report.domains.enabled.includes('fund'));
    // Only the doctor tool is implemented in M0, so every core tool is still planned.
    assert.ok(report.tools.plannedButNotRegistered.includes('hithink_quote'));
    assert.deepEqual(report.tools.registered, ['hithink_doctor']);

    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('sk-secret-value'), false, 'the key must never appear in output');
  });
});
