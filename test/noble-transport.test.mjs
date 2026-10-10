import assert from 'node:assert/strict';
import test from 'node:test';

import { configureNobleDbusAddress, withTimeout } from '../dist/bluetooth/nobleTransport.js';

test('maps the PitPat-specific D-Bus address for Noble', () => {
  const env = {
    DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/run/dbus/system_bus_socket',
    PITPAT_DBUS_SYSTEM_BUS_ADDRESS: ' unix:path=/run/host-dbus/system_bus_socket ',
  };

  configureNobleDbusAddress(env);

  assert.equal(env.DBUS_SYSTEM_BUS_ADDRESS, 'unix:path=/run/host-dbus/system_bus_socket');
});

test('preserves the existing D-Bus address when no PitPat override is configured', () => {
  const env = { DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/run/dbus/system_bus_socket' };

  configureNobleDbusAddress(env);

  assert.equal(env.DBUS_SYSTEM_BUS_ADDRESS, 'unix:path=/run/dbus/system_bus_socket');
});

test('rejects a stalled BLE operation instead of blocking reconnect forever', async () => {
  await assert.rejects(withTimeout(new Promise(() => undefined), 10, 'BLE connection'), {
    message: 'BLE connection timed out after 10 ms',
  });
});
