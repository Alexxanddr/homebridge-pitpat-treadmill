import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
  CommandType,
  decodeStatus,
  encodeCommand,
  encodeSetSpeed,
  percentageToSpeed,
  ProtocolError,
  speedToPercentage,
  validateRequestedSpeed,
} from '../dist/protocol/pitpatProtocol.js';

function stoppedPacket() {
  const packet = Buffer.from(
    '663500000000000000000000000000000000000000000000152501177000050a746e713531625831347232534a3730310000005343',
    'hex',
  );
  packet.fill(0x2a, 32, 48);
  let checksum = 0;
  for (let index = 1; index < packet.length - 2; index += 1) checksum ^= packet[index];
  packet[packet.length - 2] = checksum;
  return packet;
}

test('encodes the BA10-B STOP command observed through FBA1', () => {
  assert.equal(encodeCommand(CommandType.Stop).toString('hex'), '6a1700000000000001005000000000000dba9d76eff543');
});

test('encodes speed in milli-km/h and computes XOR checksum', () => {
  const packet = encodeSetSpeed(1.6);
  assert.equal(packet.readUInt16BE(6), 1600);
  assert.equal(packet[8], 5);
  assert.equal(packet[12], CommandType.StartOrSetSpeed);
  let checksum = 0;
  for (let index = 1; index < 21; index += 1) checksum ^= packet[index];
  assert.equal(packet[21], checksum);
});

test('decodes the anonymized BA10-B stopped notification', () => {
  const status = decodeStatus(stoppedPacket());
  assert.equal(status.currentSpeedKph, 0);
  assert.equal(status.targetSpeedKph, 0);
  assert.equal(status.maximumSpeedKph, 6);
  assert.equal(status.firmwareVersion, 37);
  assert.equal(status.deviceType, 5);
  assert.equal(status.runningState, 'stopped');
  assert.equal(status.serialNumber, '****************');
});

test('rejects corrupt and truncated notifications', () => {
  const corrupt = stoppedPacket();
  corrupt[10] ^= 1;
  assert.throws(() => decodeStatus(corrupt), ProtocolError);
  assert.throws(() => decodeStatus(Buffer.alloc(12)), ProtocolError);
});

test('converts speed percentages and quantizes to 0.1 km/h', () => {
  assert.equal(percentageToSpeed(50, 6), 3);
  assert.equal(percentageToSpeed(34, 6), 2);
  assert.equal(speedToPercentage(3, 6), 50);
});

test('validates both configured and device speed limits', () => {
  assert.equal(validateRequestedSpeed(4.04, 5, 6), 4);
  assert.throws(() => validateRequestedSpeed(5.1, 5, 6), RangeError);
  assert.throws(() => validateRequestedSpeed(1.4, 6, 6), RangeError);
});
