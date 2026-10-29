import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../lib/index.js';

/** Minimal stand-in for the host cordis context. */
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
  const { ctx, registered, warnings } = fakeContext();
  apply(ctx, undefined);
  assert.deepEqual(registered.map((tool) => tool.name), ['hithink_doctor']);
  assert.equal(warnings.length, 1, 'missing key is warned exactly once');
  assert.match(warnings[0], /no API key resolved/);
});

test('apply is silent when a key exists', () => {
  const { ctx, registered, warnings } = fakeContext();
  apply(ctx, { apiKey: 'sk-test-123456' });
  assert.equal(registered.length, 1);
  assert.deepEqual(warnings, []);
});

test('apply registers nothing when disabled', () => {
  const { ctx, registered } = fakeContext();
  apply(ctx, { enabled: false });
  assert.deepEqual(registered, []);
});

test('apply never throws, even with a hostile config or context', () => {
  assert.doesNotThrow(() => apply(undefined, undefined));
  assert.doesNotThrow(() => apply(null, null));
  assert.doesNotThrow(() => apply({ inject: () => { throw new Error('boom'); } }, {}));
  assert.doesNotThrow(() => apply({ logger: () => { throw new Error('boom'); } }, {}));
});

test('the doctor tool reports where it looked, never the key', () => {
  const { ctx, registered } = fakeContext();
  apply(ctx, { apiKey: 'sk-secret-value', domains: { fund: true } });
  const doctor = registered[0];
  const report = doctor.execute({});

  assert.equal(report.ok, true);
  assert.equal(report.auth.configured, true);
  assert.equal(report.auth.source, 'config');
  assert.ok(Array.isArray(report.auth.credentialFiles));
  assert.ok(report.domains.enabled.includes('fund'));

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('sk-secret-value'), false, 'the key must never appear in output');
});
