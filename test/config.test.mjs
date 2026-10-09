import assert from 'node:assert/strict';
import test from 'node:test';

import { validateConfig } from '../dist/config/config.js';

test('remote start is safely disabled by default', () => {
  const config = validateConfig({ platform: 'PitPatTreadmill', deviceIdentifier: 'device-1' });
  assert.equal(config.allowRemoteStart, false);
  assert.equal(config.maximumSpeedKph, 6);
});

test('remote start requires a separate risk acknowledgement', () => {
  assert.throws(
    () => validateConfig({ platform: 'PitPatTreadmill', deviceIdentifier: 'device-1', allowRemoteStart: true }),
    /acknowledgeRemoteStartRisk/,
  );
});

test('rejects unsafe or missing device configuration', () => {
  assert.throws(() => validateConfig({ platform: 'PitPatTreadmill' }), /deviceIdentifier/);
  assert.throws(
    () => validateConfig({ platform: 'PitPatTreadmill', deviceIdentifier: 'device-1', maximumSpeedKph: 7 }),
    /maximumSpeedKph/,
  );
});
