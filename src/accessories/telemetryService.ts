import type { API, Characteristic, PlatformAccessory, Service } from 'homebridge';

import { PLUGIN_NAME } from '../settings.js';
import type { ConnectionState, TreadmillStatus } from '../types/treadmill.js';

interface TelemetryCharacteristics {
  currentSpeed: Characteristic;
  targetSpeed: Characteristic;
  distance: Characteristic;
  duration: Characteristic;
  steps: Characteristic;
  calories: Characteristic;
  connected: Characteristic;
}

export class TelemetryService {
  private readonly service: Service;
  private readonly characteristics: TelemetryCharacteristics;

  public constructor(accessory: PlatformAccessory, api: API) {
    const serviceUuid = api.hap.uuid.generate(`${PLUGIN_NAME}:service:treadmill-telemetry`);
    this.service =
      accessory.services.find((service) => service.UUID === serviceUuid) ??
      accessory.addService(new api.hap.Service('Treadmill Telemetry', serviceUuid, 'telemetry'));

    this.characteristics = {
      currentSpeed: this.metric(api, 'Current Speed', 'current-speed', api.hap.Formats.FLOAT, 'km/h', 0, 6, 0.1),
      targetSpeed: this.metric(api, 'Target Speed', 'target-speed', api.hap.Formats.FLOAT, 'km/h', 0, 6, 0.1),
      distance: this.metric(api, 'Distance', 'distance', api.hap.Formats.FLOAT, 'km', 0, 1_000_000, 0.001),
      duration: this.metric(api, 'Workout Duration', 'duration', api.hap.Formats.UINT32, api.hap.Units.SECONDS, 0),
      steps: this.metric(api, 'Steps', 'steps', api.hap.Formats.UINT32, 'steps', 0),
      calories: this.metric(api, 'Calories', 'calories', api.hap.Formats.UINT32, 'kcal', 0),
      connected: this.metric(api, 'BLE Connected', 'connected', api.hap.Formats.BOOL),
    };
  }

  public updateStatus(status: TreadmillStatus): void {
    this.characteristics.currentSpeed.updateValue(status.currentSpeedKph);
    this.characteristics.targetSpeed.updateValue(status.targetSpeedKph);
    this.characteristics.distance.updateValue(status.distanceKm);
    this.characteristics.duration.updateValue(Math.round(status.durationSeconds));
    this.characteristics.steps.updateValue(status.steps);
    this.characteristics.calories.updateValue(status.caloriesKcal);
  }

  public updateConnection(state: ConnectionState): void {
    this.characteristics.connected.updateValue(state === 'ready');
  }

  private metric(
    api: API,
    name: string,
    id: string,
    format: string,
    unit?: string,
    minValue?: number,
    maxValue?: number,
    minStep?: number,
  ): Characteristic {
    const uuid = api.hap.uuid.generate(`${PLUGIN_NAME}:characteristic:${id}`);
    const existing = this.service.characteristics.find((characteristic) => characteristic.UUID === uuid);
    if (existing) {
      return existing;
    }
    const characteristic = new api.hap.Characteristic(name, uuid, {
      format,
      perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
      ...(unit === undefined ? {} : { unit }),
      ...(minValue === undefined ? {} : { minValue }),
      ...(maxValue === undefined ? {} : { maxValue }),
      ...(minStep === undefined ? {} : { minStep }),
    });
    this.service.addCharacteristic(characteristic);
    return characteristic;
  }
}
