import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { API, Logger } from 'homebridge';

import type { BleManager } from '../bluetooth/bleManager.js';
import type { ValidatedConfig } from '../config/config.js';
import { MINIMUM_COMMAND_SPEED_KPH, percentageToSpeed, speedToPercentage } from '../protocol/pitpatProtocol.js';
import { RunningState, type ConnectionState, type StatusEvent } from '../types/treadmill.js';
import { TelemetryService } from './telemetryService.js';

export class TreadmillAccessory {
  private readonly fanService: Service;
  private readonly telemetryService: TelemetryService;
  private targetSpeedKph = MINIMUM_COMMAND_SPEED_KPH;

  public constructor(
    private readonly accessory: PlatformAccessory,
    private readonly bleManager: BleManager,
    private readonly config: ValidatedConfig,
    private readonly api: API,
    private readonly log: Logger,
  ) {
    const { Characteristic, Service } = api.hap;
    this.fanService = accessory.getService(Service.Fanv2) ?? accessory.addService(Service.Fanv2, config.name);
    this.telemetryService = new TelemetryService(accessory, api);
    this.fanService.setCharacteristic(Characteristic.Name, config.name);
    this.fanService.getCharacteristic(Characteristic.RotationSpeed).setProps({
      minValue: 0,
      maxValue: 100,
      minStep: (0.1 / config.maximumSpeedKph) * 100,
    });

    this.fanService
      .getCharacteristic(Characteristic.Active)
      .onGet(() => this.isActive())
      .onSet(async (value) => this.setActive(value));
    this.fanService
      .getCharacteristic(Characteristic.RotationSpeed)
      .onGet(() => this.currentSpeedPercentage())
      .onSet(async (value) => this.setSpeed(value));
    this.fanService.getCharacteristic(Characteristic.CurrentFanState).onGet(() => this.currentFanState());
    this.fanService.getCharacteristic(Characteristic.StatusFault).onGet(() => this.statusFault());

    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'PitPat (unofficial integration)')
      .setCharacteristic(Characteristic.Model, 'BA10-B')
      .setCharacteristic(Characteristic.SerialNumber, 'BLE device');

    bleManager.on('status', (event) => this.updateStatus(event));
    bleManager.on('connectionState', (state) => this.updateConnectionState(state));
  }

  private isActive(): number {
    const state = this.bleManager.status?.runningState;
    return state === RunningState.Running || state === RunningState.Starting
      ? this.api.hap.Characteristic.Active.ACTIVE
      : this.api.hap.Characteristic.Active.INACTIVE;
  }

  private currentSpeedPercentage(): number {
    const status = this.bleManager.status;
    return status ? speedToPercentage(status.currentSpeedKph, this.effectiveMaximumSpeed(status.maximumSpeedKph)) : 0;
  }

  private currentFanState(): number {
    const state = this.bleManager.status?.runningState;
    if (state === RunningState.Running || state === RunningState.Starting) {
      return this.api.hap.Characteristic.CurrentFanState.BLOWING_AIR;
    }
    if (state === RunningState.Paused) {
      return this.api.hap.Characteristic.CurrentFanState.IDLE;
    }
    return this.api.hap.Characteristic.CurrentFanState.INACTIVE;
  }

  private statusFault(): number {
    return this.bleManager.state === 'ready'
      ? this.api.hap.Characteristic.StatusFault.NO_FAULT
      : this.api.hap.Characteristic.StatusFault.GENERAL_FAULT;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    const active = Number(value) === this.api.hap.Characteristic.Active.ACTIVE;
    if (!active) {
      await this.bleManager.stopTreadmill();
      return;
    }
    if (!this.config.allowRemoteStart) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
    await this.bleManager.startTreadmill(this.targetSpeedKph);
  }

  private async setSpeed(value: CharacteristicValue): Promise<void> {
    const percentage = Number(value);
    if (percentage === 0) {
      await this.bleManager.stopTreadmill();
      return;
    }
    const deviceMaximum = this.bleManager.status?.maximumSpeedKph ?? this.config.maximumSpeedKph;
    const requested = percentageToSpeed(percentage, this.effectiveMaximumSpeed(deviceMaximum));
    this.targetSpeedKph = Math.max(MINIMUM_COMMAND_SPEED_KPH, requested);
    if (this.bleManager.status?.runningState === RunningState.Running) {
      await this.bleManager.setSpeed(this.targetSpeedKph);
    } else if (this.config.allowRemoteStart) {
      await this.bleManager.startTreadmill(this.targetSpeedKph);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
  }

  private updateStatus({ status }: StatusEvent): void {
    const { Characteristic } = this.api.hap;
    this.targetSpeedKph =
      status.targetSpeedKph >= MINIMUM_COMMAND_SPEED_KPH ? status.targetSpeedKph : this.targetSpeedKph;
    this.fanService.updateCharacteristic(Characteristic.Active, this.isActive());
    this.fanService.updateCharacteristic(Characteristic.RotationSpeed, this.currentSpeedPercentage());
    this.fanService.updateCharacteristic(Characteristic.CurrentFanState, this.currentFanState());
    this.fanService.updateCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.NO_FAULT);
    this.telemetryService.updateStatus(status);
    if (this.config.debug) {
      this.log.debug(`[PiTPAT] Speed updated: ${status.currentSpeedKph.toFixed(1)} km/h, state ${status.runningState}`);
    }
  }

  private updateConnectionState(state: ConnectionState): void {
    this.fanService.updateCharacteristic(
      this.api.hap.Characteristic.StatusFault,
      state === 'ready'
        ? this.api.hap.Characteristic.StatusFault.NO_FAULT
        : this.api.hap.Characteristic.StatusFault.GENERAL_FAULT,
    );
    this.telemetryService.updateConnection(state);
  }

  private effectiveMaximumSpeed(deviceMaximumSpeedKph: number): number {
    return Math.min(this.config.maximumSpeedKph, deviceMaximumSpeedKph);
  }
}
