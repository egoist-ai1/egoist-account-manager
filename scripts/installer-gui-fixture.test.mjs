import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { prepareGuiFixture, executeGuiFixture, fixtureContext, validatePreparedFixture } from './installer-gui-fixture.mjs';

const guarded = process.platform === 'win32' && Boolean(process.env.CAM_INSTALLER_FIXTURE_REVIEW_SHA);

test('GUI fixture rejects a foreign work namespace before compilation or launch', async () => {
  await assert.rejects(fixtureContext({ work: 'C:\\Windows', threadId: '00000000-0000-0000-0000-000000000000' }), /context|identity|namespace|calling thread|Explicit/);
});

async function preparePathFixture() {
  const context = await fixtureContext();
  const scratch = await fs.mkdtemp(path.join(context.work, 'ig-'));
  await fs.mkdir(path.join(scratch, 'tmp'));
  return { ...context, scratch, setup: path.join(scratch, 'fixture.exe'), helper: path.join(scratch, 'ModernInstaller.exe'),
    target: path.join(scratch, 'Kvesser'), temp: path.join(scratch, 'tmp') };
}

const ownContext = process.platform === 'win32' && Boolean(process.env.CAM_TEST_WORKDIR);

test('prepared GUI fixture rejects a foreign thread ID before any native launch', { skip: !ownContext }, async () => {
  const prepared = await preparePathFixture();
  prepared.threadId = '00000000-0000-0000-0000-000000000000';
  await assert.rejects(validatePreparedFixture(prepared), /identity differs/);
});

for (const key of ['temp', 'setup']) {
  test(`prepared GUI fixture rejects escaped ${key} before any native launch`, { skip: !ownContext }, async () => {
    const prepared = await preparePathFixture();
    prepared[key] = path.join(prepared.work, key === 'temp' ? 'tmp' : 'fixture.exe');
    await assert.rejects(validatePreparedFixture(prepared), /fixed scratch layout/);
  });
}

test('prepared GUI fixture rejects a nested link before any native launch', { skip: !ownContext }, async () => {
  const prepared = await preparePathFixture();
  const link = path.join(prepared.scratch, 'linked-temp');
  await fs.symlink(prepared.temp, link, 'junction');
  try {
    await assert.rejects(validatePreparedFixture(prepared), /link\/non-regular/);
  } finally {
    await fs.unlink(link);
  }
});

let nativeFailure = false;
for (const scenario of ['initialize', 'install', 'retry']) {
  test(`guarded production GUI ${scenario} fixture`, { skip: !guarded }, async (contextTest) => {
    if (nativeFailure) { contextTest.skip('Earlier native failure requires readback before another launch'); return; }
    try {
      const context = await fixtureContext();
      assert.equal(process.env.CAM_INSTALLER_FIXTURE_REVIEW_SHA, context.reviewSha256, 'Root review must match all exact current fixture sources');
      const prepared = await prepareGuiFixture({ scenario });
      const result = await executeGuiFixture(prepared);
      assert.equal(result.status, 'passed');
      assert.equal(result.integrationUnchanged, true);
      assert.equal(result.applicationLaunched, false);
      assert.equal(result.testMode, true);
      assert.ok(result.events.some((event) => event.name === 'guards-configured' && event.data.integration === 'deny'));
    } catch (error) {
      nativeFailure = true;
      throw error;
    }
  });
}
