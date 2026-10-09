import type { PlatformConfig } from 'homebridge';

export interface PitPatConfig extends PlatformConfig {
  name?: string;
  deviceIdentifier?: string;
  maximumSpeedKph?: number;
  allowRemoteStart?: boolean;
  acknowledgeRemoteStartRisk?: boolean;
  debug?: boolean;
  reconnectInitialDelaySeconds?: number;
  reconnectMaximumDelaySeconds?: number;
}

export interface ValidatedConfig {
  name: string;
  deviceIdentifier: string;
  maximumSpeedKph: number;
  allowRemoteStart: boolean;
  debug: boolean;
  reconnectInitialDelayMs: number;
  reconnectMaximumDelayMs: number;
}

export function validateConfig(config: PitPatConfig): ValidatedConfig {
  const deviceIdentifier = config.deviceIdentifier?.trim();
  if (!deviceIdentifier) {
    throw new Error('deviceIdentifier is required; use the CoreBluetooth UUID on macOS or BLE address on Linux');
  }

  const maximumSpeedKph = config.maximumSpeedKph ?? 6;
  if (!Number.isFinite(maximumSpeedKph) || maximumSpeedKph < 1.5 || maximumSpeedKph > 6) {
    throw new Error('maximumSpeedKph must be between 1.5 and 6.0 km/h for the verified BA10-B profile');
  }

  const remoteStartRequested = config.allowRemoteStart === true;
  const riskAcknowledged = config.acknowledgeRemoteStartRisk === true;
  if (remoteStartRequested && !riskAcknowledged) {
    throw new Error('acknowledgeRemoteStartRisk must be true when allowRemoteStart is enabled');
  }

  const reconnectInitialDelayMs = (config.reconnectInitialDelaySeconds ?? 5) * 1000;
  const reconnectMaximumDelayMs = (config.reconnectMaximumDelaySeconds ?? 60) * 1000;
  if (reconnectInitialDelayMs < 1000 || reconnectMaximumDelayMs < reconnectInitialDelayMs) {
    throw new Error('reconnect delays are invalid');
  }

  return {
    name: config.name?.trim() || 'PitPat Treadmill',
    deviceIdentifier,
    maximumSpeedKph,
    allowRemoteStart: remoteStartRequested && riskAcknowledged,
    debug: config.debug === true,
    reconnectInitialDelayMs,
    reconnectMaximumDelayMs,
  };
}
