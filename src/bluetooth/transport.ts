export interface BleConnection {
  write(data: Buffer): Promise<void>;
  disconnect(): Promise<void>;
  onNotification(listener: (data: Buffer) => void): void;
  onDisconnect(listener: (reason?: unknown) => void): void;
}

export interface BleTransport {
  connect(deviceIdentifier: string, timeoutMs: number): Promise<BleConnection>;
}
