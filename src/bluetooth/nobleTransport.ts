import type { Characteristic, Noble, Peripheral } from '@stoprocent/noble';
import type { Logger } from 'homebridge';

import { FBA_NOTIFY_UUID, FBA_SERVICE_UUID, FBA_WRITE_UUID } from '../protocol/pitpatProtocol.js';
import type { BleConnection, BleTransport } from './transport.js';

function normalizeIdentifier(value: string): string {
  return value.replaceAll('-', '').replaceAll(':', '').toLowerCase();
}

class NobleConnection implements BleConnection {
  public constructor(
    private readonly peripheral: Peripheral,
    private readonly writeCharacteristic: Characteristic,
    private readonly notifyCharacteristic: Characteristic,
  ) {}

  public async initialize(): Promise<void> {
    await this.notifyCharacteristic.subscribeAsync();
  }

  public onNotification(listener: (data: Buffer) => void): void {
    this.notifyCharacteristic.on('data', (data, isNotification) => {
      if (isNotification) {
        listener(Buffer.from(data));
      }
    });
  }

  public onDisconnect(listener: (reason?: unknown) => void): void {
    this.peripheral.once('disconnect', listener);
  }

  public async write(data: Buffer): Promise<void> {
    await this.writeCharacteristic.writeAsync(data, false);
  }

  public async disconnect(): Promise<void> {
    try {
      await this.notifyCharacteristic.unsubscribeAsync();
    } finally {
      if (this.peripheral.state === 'connected') {
        await this.peripheral.disconnectAsync();
      }
    }
  }
}

export class NobleTransport implements BleTransport {
  private noble?: Noble;

  public constructor(private readonly log: Pick<Logger, 'warn'>) {}

  private async loadNoble(): Promise<Noble> {
    if (!this.noble) {
      configureNobleDbusAddress();
      const module = await import('@stoprocent/noble');
      this.noble = module.default;
    }
    return this.noble;
  }

  public async connect(deviceIdentifier: string, timeoutMs: number): Promise<BleConnection> {
    const noble = await this.loadNoble();
    await this.ensurePoweredOn(noble, timeoutMs);
    const peripheral = await this.findPeripheral(noble, deviceIdentifier, timeoutMs);
    await peripheral.connectAsync();

    try {
      const discovered = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [FBA_SERVICE_UUID],
        [FBA_WRITE_UUID, FBA_NOTIFY_UUID],
      );
      const writeCharacteristic = discovered.characteristics.find(
        (characteristic) => characteristic.uuid === FBA_WRITE_UUID,
      );
      const notifyCharacteristic = discovered.characteristics.find(
        (characteristic) => characteristic.uuid === FBA_NOTIFY_UUID,
      );
      if (!writeCharacteristic?.properties.includes('write')) {
        throw new Error('FBA1 write characteristic is missing or not writable');
      }
      if (!notifyCharacteristic?.properties.includes('notify')) {
        throw new Error('FBA2 notify characteristic is missing or does not support notifications');
      }

      const connection = new NobleConnection(peripheral, writeCharacteristic, notifyCharacteristic);
      await connection.initialize();
      return connection;
    } catch (error) {
      await peripheral.disconnectAsync().catch(() => undefined);
      throw error;
    }
  }

  private async ensurePoweredOn(noble: Noble, timeoutMs: number): Promise<void> {
    try {
      await noble.waitForPoweredOnAsync(timeoutMs);
      return;
    } catch (error) {
      if (noble.state === 'unauthorized' || noble.state === 'unsupported') {
        throw error;
      }
      this.log.warn(`[PiTPAT] BLE adapter state is ${noble.state}; attempting one controller reset`);
      noble.reset();
      try {
        await noble.waitForPoweredOnAsync(Math.min(timeoutMs, 10_000));
      } catch (recoveryError) {
        throw new Error(
          `BLE adapter did not recover after reset (state ${noble.state}): ${errorMessage(recoveryError)}`,
          { cause: recoveryError },
        );
      }
    }
  }

  private async findPeripheral(noble: Noble, configuredIdentifier: string, timeoutMs: number): Promise<Peripheral> {
    const expected = normalizeIdentifier(configuredIdentifier);
    return await new Promise<Peripheral>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        noble.removeListener('discover', onDiscover);
        void noble.stopScanningAsync().catch(() => undefined);
      };
      const finish = (peripheral: Peripheral): void => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(peripheral);
        }
      };
      const onDiscover = (peripheral: Peripheral): void => {
        const identifiers = [peripheral.id, peripheral.address].filter(Boolean).map(normalizeIdentifier);
        if (identifiers.includes(expected)) {
          finish(peripheral);
        }
      };
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`treadmill ${configuredIdentifier} was not discovered`));
        }
      }, timeoutMs);

      noble.on('discover', onDiscover);
      void noble.startScanningAsync([], false).catch((error) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}

export function configureNobleDbusAddress(env: NodeJS.ProcessEnv = process.env): void {
  const address = env.PITPAT_DBUS_SYSTEM_BUS_ADDRESS?.trim();
  if (address) {
    env.DBUS_SYSTEM_BUS_ADDRESS = address;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
