import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { linkProfile } from '../scripts/profile-link.mjs';

const NAME = 'dsh-hithink-finance';

/** A profile manifest shaped like the real one, with 2-space JSON and a BOM-free body. */
const FIXTURE = `{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {
    "dsh-backup": "0.1.1"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-backup"
      ]
    }
  }
}
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hithink-profile-'));
  const profileDir = join(root, 'profiles', 'desktop');
  mkdirSync(profileDir, { recursive: true });
  const manifest = join(profileDir, 'package.json');
  writeFileSync(manifest, FIXTURE, 'utf8');
  return { root, manifest, packageDir: join(root, 'pkg') };
}

test('add writes a link dependency and appends one bundle entry', () => {
  const { root, manifest, packageDir } = fixture();
  const result = linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.changed, true);
  assert.equal(result.report.previous, null);

  const written = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(written.dependencies[NAME], `link:${packageDir.replace(/\\/g, '/')}`);
  assert.deepEqual(written.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-backup', NAME]);
  // Untouched entries keep their relative position.
  assert.equal(written.dependencies['dsh-backup'], '0.1.1');
});

test('add is idempotent: a second run changes nothing and writes no backup', () => {
  const { root, manifest, packageDir } = fixture();
  linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir });
  const afterFirst = readFileSync(manifest, 'utf8');
  const backupsAfterFirst = readdirSync(join(root, 'profiles', 'desktop')).filter((f) => f.includes('.bak-hithink-'));

  const second = linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir });

  assert.equal(second.report.changed, false);
  assert.equal(readFileSync(manifest, 'utf8'), afterFirst);
  assert.equal(
    readdirSync(join(root, 'profiles', 'desktop')).filter((f) => f.includes('.bak-hithink-')).length,
    backupsAfterFirst.length,
  );
});

test('remove restores the original manifest byte for byte', () => {
  const { root, manifest, packageDir } = fixture();
  linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir });
  linkProfile({ action: 'remove', profile: 'desktop', dshHome: root, name: NAME, packageDir });

  assert.equal(readFileSync(manifest, 'utf8'), FIXTURE);
});

test('add reports the version it replaced instead of hiding it', () => {
  const { root, manifest, packageDir } = fixture();
  const withVersion = JSON.parse(readFileSync(manifest, 'utf8'));
  withVersion.dependencies[NAME] = '1.2.3';
  writeFileSync(manifest, JSON.stringify(withVersion, null, 2) + '\n', 'utf8');

  const result = linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir });
  assert.equal(result.report.previous, '1.2.3');
});

test('check exits 1 before install and 0 after', () => {
  const { root, packageDir } = fixture();
  assert.equal(linkProfile({ action: 'check', profile: 'desktop', dshHome: root, name: NAME, packageDir }).exitCode, 1);
  linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir });
  const after = linkProfile({ action: 'check', profile: 'desktop', dshHome: root, name: NAME, packageDir });
  assert.equal(after.exitCode, 0);
  assert.equal(after.report.ok, true);
});

test('a manifest with a BOM is read, not rejected', () => {
  const { root, manifest, packageDir } = fixture();
  writeFileSync(manifest, '\uFEFF' + FIXTURE, 'utf8');
  const result = linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir });
  assert.equal(result.exitCode, 0);
  const written = readFileSync(manifest, 'utf8');
  assert.equal(written.includes(NAME), true);
});

test('a missing profile manifest fails loudly', () => {
  const root = mkdtempSync(join(tmpdir(), 'hithink-noprofile-'));
  assert.throws(
    () => linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir: root }),
    /no profile manifest/,
  );
});

test('an unexpected dependencies shape is repaired, not crashed on', () => {
  const { root, manifest, packageDir } = fixture();
  writeFileSync(manifest, JSON.stringify({ name: 'x', dependencies: [], dsh: { profile: {} } }, null, 2), 'utf8');
  linkProfile({ action: 'add', profile: 'desktop', dshHome: root, name: NAME, packageDir });
  const written = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(Array.isArray(written.dependencies), false);
  assert.equal(written.dependencies[NAME].startsWith('link:'), true);
});
