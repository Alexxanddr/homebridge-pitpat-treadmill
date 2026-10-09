import { EventEmitter } from 'node:events';

import type { Logger } from 'homebridge';

import {
  decodeStatus,
  encodeSetSpeed,
  encodeStart,
  encodeStop,
  ProtocolError,
  validateRequestedSpeed,
} from '../protocol/pitpatProtocol.js';
import { RunningState, type ConnectionState, type StatusEvent, type TreadmillStatus } from '../types/treadmill.js';
import type { ValidatedConfig } from '../config/config.js';
import type { BleConnection, BleTransport } from './transport.js';

const CONNECTION_TIMEOUT_MS = 20_000;
const INITIAL_STATUS_TIMEOUT_MS = 7_000;
const COMMAND_CONFIRMATION_TIMEOUT_MS = 5_000;

interface BleManagerTimings {
  connectionTimeoutMs: number;
  initialStatusTimeoutMs: number;
  commandConfirmationTimeoutMs: number;
}

export interface BleManagerEvents {
  status: [StatusEvent];
  connectionState: [ConnectionState];
}

export class BleManager extends EventEmitter<BleManagerEvents> {
  private connection: BleConnection | undefined;
  private connectionState: ConnectionState = 'disconnected';
  private latestStatus: StatusEvent | undefined;
  private statusSequence = 0;
  private connectPromise: Promise<void> | undefined;
  private writeChain: Promise<void> = Promise.resolve();
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectDelayMs: number;
  private shuttingDown = false;

  public constructor(
    private readonly config: ValidatedConfig,
    private readonly transport: BleTransport,
    private readonly log: Logger,
    private readonly timings: BleManagerTimings = {
      connectionTimeoutMs: CONNECTION_TIMEOUT_MS,
      initialStatusTimeoutMs: INITIAL_STATUS_TIMEOUT_MS,
      commandConfirmationTimeoutMs: COMMAND_CONFIRMATION_TIMEOUT_MS,
    },
  ) {
    super();
    this.reconnectDelayMs = config.reconnectInitialDelayMs;
  }

  public get state(): ConnectionState {
    return this.connectionState;
  }

  public get status(): TreadmillStatus | undefined {
    return this.latestStatus?.status;
  }

  public async start(): Promise<void> {
    await this.connect();
  }

  public async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (this.connectionState === 'ready') {
      return;
    }

    this.connectPromise = this.connectInternal().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private async connectInternal(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    this.setConnectionState('connecting');
    this.log.info('[PiTPAT] Searching for treadmill...');
    try {
      const connection = await this.transport.connect(this.config.deviceIdentifier, this.timings.connectionTimeoutMs);
      if (this.shuttingDown) {
        await connection.disconnect();
        return;
      }
      this.connection = connection;
      connection.onNotification((data) => this.handleNotification(data));
      connection.onDisconnect((reason) => this.handleDisconnect(reason));
      this.log.info('[PiTPAT] BLE connected');
      this.log.info('[PiTPAT] Notifications enabled');
      this.setConnectionState('verifying');
      await this.waitForStatus(() => true, this.timings.initialStatusTimeoutMs);
      this.reconnectDelayMs = this.config.reconnectInitialDelayMs;
      this.setConnectionState('ready');
    } catch (error) {
      this.log.error(`[PiTPAT] BLE connection failed: ${errorMessage(error)}`);
      await this.closeConnection();
      this.setConnectionState('disconnected');
      this.scheduleReconnect();
      throw error;
    }
  }

  private handleNotification(data: Buffer): void {
    try {
      const status = decodeStatus(data);
      const event = { status, receivedAt: Date.now() };
      this.latestStatus = event;
      this.statusSequence += 1;
      if (this.config.debug) {
        this.log.debug(`[PiTPAT] RX ${redactStatusPacket(data)}`);
      }
      this.emit('status', event);
    } catch (error) {
      if (error instanceof ProtocolError) {
        this.log.warn(`[PiTPAT] Ignoring invalid notification: ${error.message}`);
      } else {
        this.log.error(`[PiTPAT] Failed to decode notification: ${errorMessage(error)}`);
      }
    }
  }

  private handleDisconnect(reason?: unknown): void {
    if (this.connectionState === 'disconnected' || this.connectionState === 'disconnecting') {
      return;
    }
    this.connection = undefined;
    this.latestStatus = undefined;
    this.setConnectionState('disconnected');
    this.log.warn(`[PiTPAT] BLE disconnected${reason === undefined ? '' : `: ${errorMessage(reason)}`}`);
    this.scheduleReconnect();
  }

  public async stopTreadmill(): Promise<void> {
    await this.sendAndConfirm(
      encodeStop(),
      (status) => status.runningState === RunningState.Stopped && status.currentSpeedKph === 0,
      'stop',
    );
  }

  public async setSpeed(speedKph: number): Promise<void> {
    const current = this.requireFreshReadyStatus();
    if (current.runningState !== RunningState.Running) {
      throw new Error('speed changes are allowed only after the treadmill reports that it is running');
    }
    const speed = validateRequestedSpeed(speedKph, this.config.maximumSpeedKph, current.maximumSpeedKph);
    await this.sendAndConfirm(
      encodeSetSpeed(speed),
      (status) => Math.abs(status.targetSpeedKph - speed) <= 0.11,
      `set speed to ${speed.toFixed(1)} km/h`,
    );
  }

  public async startTreadmill(speedKph: number): Promise<void> {
    if (!this.config.allowRemoteStart) {
      throw new Error('remote start is disabled by configuration');
    }
    const current = this.requireFreshReadyStatus();
    if (current.runningState !== RunningState.Stopped && current.runningState !== RunningState.Paused) {
      throw new Error(`cannot start from state ${current.runningState}`);
    }
    const speed = validateRequestedSpeed(speedKph, this.config.maximumSpeedKph, current.maximumSpeedKph);
    await this.sendAndConfirm(
      encodeStart(speed),
      (status) => status.runningState === RunningState.Running || status.runningState === RunningState.Starting,
      `start at ${speed.toFixed(1)} km/h`,
    );
  }

  private requireFreshReadyStatus(): TreadmillStatus {
    if (this.connectionState !== 'ready' || !this.connection || !this.latestStatus) {
      throw new Error('BLE state is not ready and verified');
    }
    if (Date.now() - this.latestStatus.receivedAt > 3_000) {
      throw new Error('treadmill status is stale');
    }
    return this.latestStatus.status;
  }

  private async sendAndConfirm(
    data: Buffer,
    predicate: (status: TreadmillStatus) => boolean,
    description: string,
  ): Promise<void> {
    const operation = this.writeChain.then(async () => {
      this.requireFreshReadyStatus();
      const connection = this.connection;
      if (!connection) {
        throw new Error('BLE connection is unavailable');
      }
      if (this.config.debug) {
        this.log.debug(`[PiTPAT] TX ${data.toString('hex')}`);
      }
      const statusSequenceBeforeWrite = this.statusSequence;
      await connection.write(data);
      await this.waitForStatus((status) => {
        const fresh = this.statusSequence > statusSequenceBeforeWrite;
        return fresh && predicate(status);
      }, this.timings.commandConfirmationTimeoutMs);
      this.log.info(`[PiTPAT] Confirmed ${description}`);
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  private async waitForStatus(
    predicate: (status: TreadmillStatus) => boolean,
    timeoutMs: number,
  ): Promise<TreadmillStatus> {
    if (this.latestStatus && predicate(this.latestStatus.status)) {
      return this.latestStatus.status;
    }
    return await new Promise<TreadmillStatus>((resolve, reject) => {
      const onStatus = (event: StatusEvent): void => {
        if (predicate(event.status)) {
          cleanup();
          resolve(event.status);
        }
      };
      const onConnectionState = (state: ConnectionState): void => {
        if (state === 'disconnected' || state === 'disconnecting') {
          cleanup();
          reject(new Error('BLE disconnected while waiting for treadmill confirmation'));
        }
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        this.removeListener('status', onStatus);
        this.removeListener('connectionState', onConnectionState);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('timed out waiting for treadmill confirmation'));
      }, timeoutMs);
      this.on('status', onStatus);
      this.on('connectionState', onConnectionState);
    });
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.reconnectTimer) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.log.info(`[PiTPAT] Reconnecting in ${Math.round(delay / 1000)} seconds...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => undefined);
    }, delay);
    this.reconnectTimer.unref();
    this.reconnectDelayMs = Math.min(delay * 2, this.config.reconnectMaximumDelayMs);
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.setConnectionState('disconnecting');
    await this.closeConnection();
    this.setConnectionState('disconnected');
  }

  private async closeConnection(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (connection) {
      await connection.disconnect().catch((error) => {
        this.log.warn(`[PiTPAT] BLE disconnect error: ${errorMessage(error)}`);
      });
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit('connectionState', state);
    }
  }
}

function redactStatusPacket(data: Buffer): string {
  const copy = Buffer.from(data);
  if (copy.length >= 48) {
    copy.fill(0x2a, 32, 48);
  }
  return copy.toString('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
