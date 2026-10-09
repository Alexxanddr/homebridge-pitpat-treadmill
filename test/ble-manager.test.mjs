import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { setImmediate, setTimeout } from 'node:timers';

import { BleManager } from '../dist/bluetooth/bleManager.js';

function statusPacket(stateBits = 0, speedMilliKph = 0, targetMilliKph = 0) {
  const packet = Buffer.alloc(53);
  packet[0] = 0x66;
  packet[1] = packet.length;
  packet.writeUInt16BE(speedMilliKph, 3);
  packet.writeUInt16BE(targetMilliKph, 5);
  packet[25] = 37;
  packet[26] = stateBits | 1;
  packet.writeUInt16BE(6000, 27);
  packet[30] = 5;
  packet[52] = 0x43;
  for (let index = 1; index < packet.length - 2; index += 1) packet[51] ^= packet[index];
  return packet;
}

class MockConnection {
  writes = [];
  notificationListener = () => {};
  disconnectListener = () => {};
  confirmWrites = true;

  onNotification(listener) {
    this.notificationListener = listener;
    setImmediate(() => listener(statusPacket()));
  }
  onDisconnect(listener) {
    this.disconnectListener = listener;
  }
  async disconnect() {}
  async write(data) {
    this.writes.push(Buffer.from(data));
    if (this.confirmWrites) setImmediate(() => this.notificationListener(statusPacket()));
  }
}

class MockTransport {
  connections = [];
  async connect() {
    const connection = new MockConnection();
    this.connections.push(connection);
    return connection;
  }
}

const config = {
  name: 'Test',
  deviceIdentifier: 'test-device',
  maximumSpeedKph: 6,
  allowRemoteStart: false,
  debug: false,
  reconnectInitialDelayMs: 5,
  reconnectMaximumDelayMs: 10,
};
const logger = { info() {}, warn() {}, error() {}, debug() {}, success() {}, log() {}, prefix: '' };
const timings = { connectionTimeoutMs: 50, initialStatusTimeoutMs: 50, commandConfirmationTimeoutMs: 20 };

test('startup and reconnect never replay a motor command', async () => {
  const transport = new MockTransport();
  const manager = new BleManager(config, transport, logger, timings);
  await manager.start();
  assert.equal(transport.connections[0].writes.length, 0);
  transport.connections[0].disconnectListener('test');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(transport.connections.length, 2);
  assert.equal(transport.connections[1].writes.length, 0);
  await manager.shutdown();
});

test('STOP waits for a fresh confirming notification', async () => {
  const transport = new MockTransport();
  const manager = new BleManager(config, transport, logger, timings);
  await manager.start();
  await manager.stopTreadmill();
  assert.equal(transport.connections[0].writes.length, 1);
  assert.equal(transport.connections[0].writes[0][12], 0);
  await manager.shutdown();
});

test('a write without status confirmation times out', async () => {
  const transport = new MockTransport();
  const manager = new BleManager(config, transport, logger, timings);
  await manager.start();
  transport.connections[0].confirmWrites = false;
  await assert.rejects(manager.stopTreadmill(), /timed out/);
  await manager.shutdown();
});

test('a disconnect rejects an in-flight command without waiting for its timeout', async () => {
  const transport = new MockTransport();
  const manager = new BleManager(config, transport, logger, {
    ...timings,
    commandConfirmationTimeoutMs: 1_000,
  });
  await manager.start();
  transport.connections[0].confirmWrites = false;
  const command = manager.stopTreadmill();
  await new Promise((resolve) => setImmediate(resolve));
  transport.connections[0].disconnectListener(8);
  await assert.rejects(command, /BLE disconnected/);
  await manager.shutdown();
});

test('remote start is rejected before any BLE write', async () => {
  const transport = new MockTransport();
  const manager = new BleManager(config, transport, logger, timings);
  await manager.start();
  await assert.rejects(manager.startTreadmill(1.5), /disabled/);
  assert.equal(transport.connections[0].writes.length, 0);
  await manager.shutdown();
});
