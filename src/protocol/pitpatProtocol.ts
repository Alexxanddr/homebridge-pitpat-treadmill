import { RunningState, type TreadmillStatus } from '../types/treadmill.js';

export const FBA_SERVICE_UUID = 'fba0';
export const FBA_WRITE_UUID = 'fba1';
export const FBA_NOTIFY_UUID = 'fba2';
export const VERIFIED_DEVICE_MAX_SPEED_KPH = 6;
export const MINIMUM_COMMAND_SPEED_KPH = 1.5;

const COMMAND_PACKET_LENGTH = 23;
const USER_ID = 58_965_456_623n;

export enum CommandType {
  Stop = 0,
  Pause = 2,
  StartOrSetSpeed = 4,
}

export class ProtocolError extends Error {}

function xorChecksum(data: Uint8Array, start: number, endExclusive: number): number {
  let checksum = 0;
  for (let index = start; index < endExclusive; index += 1) {
    checksum ^= data[index] ?? 0;
  }
  return checksum;
}

export function encodeCommand(command: CommandType, speedKph = 0, accelerationSeconds: 1 | 5 = 1): Buffer {
  if (!Number.isFinite(speedKph) || speedKph < 0 || speedKph > VERIFIED_DEVICE_MAX_SPEED_KPH) {
    throw new RangeError(`speed must be between 0 and ${VERIFIED_DEVICE_MAX_SPEED_KPH} km/h`);
  }
  if (command === CommandType.StartOrSetSpeed && speedKph < MINIMUM_COMMAND_SPEED_KPH) {
    throw new RangeError(`start/set-speed requires at least ${MINIMUM_COMMAND_SPEED_KPH} km/h`);
  }

  const speedMilliKph = Math.round(speedKph * 1000);
  const packet = Buffer.alloc(COMMAND_PACKET_LENGTH);
  packet[0] = 0x6a;
  packet[1] = COMMAND_PACKET_LENGTH;
  packet.writeUInt16BE(speedMilliKph, 6);
  packet[8] = accelerationSeconds;
  packet[10] = 80;
  packet[12] = command & 0xf7;
  packet.writeBigUInt64BE(USER_ID, 13);
  packet[21] = xorChecksum(packet, 1, 21);
  packet[22] = 0x43;
  return packet;
}

export const encodeStop = (): Buffer => encodeCommand(CommandType.Stop);

export function encodeSetSpeed(speedKph: number): Buffer {
  return encodeCommand(CommandType.StartOrSetSpeed, quantizeSpeed(speedKph), 5);
}

export function encodeStart(speedKph: number): Buffer {
  return encodeCommand(CommandType.StartOrSetSpeed, quantizeSpeed(speedKph), 1);
}

export function quantizeSpeed(speedKph: number): number {
  return Math.round((speedKph + Number.EPSILON) * 10) / 10;
}

export function validateRequestedSpeed(
  speedKph: number,
  configuredMaximumKph: number,
  deviceMaximumKph: number,
): number {
  const maximum = Math.min(configuredMaximumKph, deviceMaximumKph, VERIFIED_DEVICE_MAX_SPEED_KPH);
  const quantized = quantizeSpeed(speedKph);
  if (!Number.isFinite(quantized) || quantized < MINIMUM_COMMAND_SPEED_KPH || quantized > maximum) {
    throw new RangeError(`speed must be between ${MINIMUM_COMMAND_SPEED_KPH} and ${maximum.toFixed(1)} km/h`);
  }
  return quantized;
}

export function speedToPercentage(speedKph: number, maximumSpeedKph: number): number {
  if (speedKph <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (speedKph / maximumSpeedKph) * 100));
}

export function percentageToSpeed(percentage: number, maximumSpeedKph: number): number {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new RangeError('percentage must be between 0 and 100');
  }
  return quantizeSpeed((percentage / 100) * maximumSpeedKph);
}

export function decodeStatus(packet: Uint8Array): TreadmillStatus {
  if (packet.length < 31) {
    throw new ProtocolError(`status packet is too short: ${packet.length}`);
  }
  if (packet[0] !== 0x66) {
    throw new ProtocolError(`unexpected status start byte: 0x${(packet[0] ?? 0).toString(16)}`);
  }
  if (packet[1] !== packet.length) {
    throw new ProtocolError(`status length mismatch: declared ${packet[1]}, received ${packet.length}`);
  }
  if (packet.at(-1) !== 0x43) {
    throw new ProtocolError('invalid status end byte');
  }
  const expectedChecksum = xorChecksum(packet, 1, packet.length - 2);
  if (packet.at(-2) !== expectedChecksum) {
    throw new ProtocolError('invalid status checksum');
  }

  const view = Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength);
  const flags = packet[26] ?? 0;
  const stateBits = flags & 0x18;
  const runningState =
    stateBits === 0x18
      ? RunningState.Starting
      : stateBits === 0x08
        ? RunningState.Running
        : stateBits === 0x10
          ? RunningState.Paused
          : RunningState.Stopped;
  const firmwareVersion = packet[25] ?? 0;
  const rawDuration = view.readUInt32BE(20);
  const serialBytes = packet.length >= 48 ? view.subarray(32, 48) : undefined;
  const serialNumber = serialBytes?.toString('ascii').replaceAll('\0', '').trim();

  return {
    currentSpeedKph: view.readUInt16BE(3) / 1000,
    targetSpeedKph: view.readUInt16BE(5) / 1000,
    distanceKm: view.readUInt32BE(7) / 1000,
    steps: view.readUInt32BE(14),
    caloriesKcal: view.readUInt16BE(18),
    durationSeconds: firmwareVersion > 19 ? rawDuration / 1000 : rawDuration,
    runningState,
    firmwareVersion,
    maximumSpeedKph: view.readUInt16BE(27) / 1000,
    deviceType: (packet[30] ?? 0) & 0x1f,
    ...(serialNumber ? { serialNumber } : {}),
  };
}
