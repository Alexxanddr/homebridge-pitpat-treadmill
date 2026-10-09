import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';

import { TreadmillAccessory } from './accessories/treadmillAccessory.js';
import { BleManager } from './bluetooth/bleManager.js';
import { NobleTransport } from './bluetooth/nobleTransport.js';
import { validateConfig, type ValidatedConfig } from './config/config.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class PitPatPlatform implements DynamicPlatformPlugin {
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly validatedConfig?: ValidatedConfig;
  private bleManager?: BleManager;

  public constructor(
    private readonly log: Logger,
    config: PlatformConfig,
    private readonly api: API,
  ) {
    if (!config.deviceIdentifier) {
      log.warn('[PiTPAT] Plugin is not configured; set deviceIdentifier in Homebridge settings');
      return;
    }
    try {
      this.validatedConfig = validateConfig(config);
    } catch (error) {
      log.error(`[PiTPAT] Invalid configuration: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    api.on('didFinishLaunching', () => this.launch());
    api.on('shutdown', () => this.shutdown());
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private launch(): void {
    const config = this.validatedConfig;
    if (!config) {
      return;
    }
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${config.deviceIdentifier.toLowerCase()}`);
    let accessory = this.cachedAccessories.get(uuid);
    if (!accessory) {
      accessory = new this.api.platformAccessory(config.name, uuid, this.api.hap.Categories.FAN);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.bleManager = new BleManager(config, new NobleTransport(this.log), this.log);
    new TreadmillAccessory(accessory, this.bleManager, config, this.api, this.log);
    void this.bleManager.start().catch(() => undefined);

    const staleAccessories = [...this.cachedAccessories.values()].filter((cached) => cached.UUID !== uuid);
    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }
  }

  private shutdown(): void {
    void this.bleManager?.shutdown();
  }
}
