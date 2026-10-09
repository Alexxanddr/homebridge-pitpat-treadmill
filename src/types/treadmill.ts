export enum RunningState {
  Starting = 'starting',
  Running = 'running',
  Paused = 'paused',
  Stopped = 'stopped',
}

export interface TreadmillStatus {
  currentSpeedKph: number;
  targetSpeedKph: number;
  maximumSpeedKph: number;
  distanceKm: number;
  steps: number;
  caloriesKcal: number;
  durationSeconds: number;
  runningState: RunningState;
  firmwareVersion: number;
  deviceType: number;
  serialNumber?: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'verifying' | 'ready' | 'disconnecting';

export interface StatusEvent {
  status: TreadmillStatus;
  receivedAt: number;
}
