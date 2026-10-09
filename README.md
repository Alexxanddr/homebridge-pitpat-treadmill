# homebridge-pitpat-treadmill

An unofficial, local-only Homebridge plugin for monitoring and controlling a PitPat treadmill over Bluetooth Low Energy. It does not require Python, the PitPat app, a cloud account, or an external server.

> [!WARNING]
> A treadmill is motorized equipment. Remote control can cause injury or property damage. Remote motor start is disabled by default. A BLE stop command is not a certified emergency stop and does not replace the treadmill's physical safety controls.

## Current status

This project is under active hardware validation. Do not enable remote start until you have confirmed the protocol and safe behavior on your own treadmill.

| Model         | BLE discovery     | State notifications | State decoding                         | STOP         | Speed control                   | Remote start                      |
| ------------- | ----------------- | ------------------- | -------------------------------------- | ------------ | ------------------------------- | --------------------------------- |
| PitPat BA10-B | Verified on macOS | Verified            | Verified stopped, starting and running | Verified     | Verified at 0.1 km/h resolution | Verified, but disabled by default |
| Other models  | Not verified      | Not verified        | Not verified                           | Not verified | Not verified                    | Not supported                     |

The tested BA10-B advertises as `PitPat-T01` and exposes service `FBA0`, write characteristic `FBA1`, and notify characteristic `FBA2`. Its verified speed range is 1.5–6.0 km/h. A similar advertised name does not prove compatibility.

## Features

- Dynamic Homebridge platform with Config UI X schema.
- Direct local BLE communication using `@stoprocent/noble`.
- Push updates from BLE notifications; no routine polling.
- Current and target speed decoding.
- Distance, duration, steps, and calorie decoding in the internal state model.
- Automatic reconnect with bounded exponential backoff.
- Exact configured-device matching to avoid connecting to a nearby treadmill by name.
- Packet length, framing, checksum, and speed validation.
- Remote start disabled by default and never restored after startup or reconnect.
- Debug packet logging with serial-number bytes redacted.

## HomeKit representation

HomeKit has no treadmill service. The plugin uses `FanV2`, the least misleading standard service that exposes both an active state and a percentage control:

- `Active` reflects treadmill movement. Setting it inactive requests STOP.
- `RotationSpeed` maps the treadmill speed range to 0–100%.
- `CurrentFanState` reflects stopped, paused, or moving state.
- `StatusFault` reports an unavailable or unverified BLE connection.

Apple Home displays a percentage rather than km/h and may round slider values. The plugin converts the percentage back to km/h and quantizes it to 0.1 km/h. Workout metrics have no semantically correct standard HomeKit characteristics. The plugin therefore exposes current speed, target speed, distance, duration, steps, calories, and BLE connection through a secondary custom telemetry service. Third-party HAP clients may display it, but Apple Home normally hides custom characteristics; the plugin does not mislabel these values as unrelated standard sensors.

## Requirements

- Homebridge 2.x.
- Node.js 22.12 or later in the Node 22 line, Node 24, or Node 26.
- A host with a working BLE adapter accessible to the Homebridge process.
- A PitPat BA10-B matching the verified FBA profile.

Only macOS discovery and connectivity have currently been verified with the BA10-B. Linux, Raspberry Pi OS, and Docker remain unverified until hardware testing is completed on those platforms.

## Installation

The package has not yet been published. For local development:

```bash
git clone https://github.com/Alexxanddr/homebridge-pitpat-treadmill.git
cd homebridge-pitpat-treadmill
npm install
npm run check
npm link
```

Once a release is published, installation will use:

```bash
npm install -g homebridge-pitpat-treadmill
```

## Configuration

Use Homebridge Config UI X or add the platform block manually:

```json
{
  "platform": "PitPatTreadmill",
  "name": "PitPat Treadmill",
  "deviceIdentifier": "4A3052F3-5AC0-7895-12F1-73E776FEE399",
  "maximumSpeedKph": 6,
  "debug": false,
  "allowRemoteStart": false,
  "acknowledgeRemoteStartRisk": false
}
```

The UUID above is an example. Use the identifier reported for your treadmill. CoreBluetooth identifiers on macOS are host-specific and are not the device's public Bluetooth MAC address.

### Options

| Option                         | Default            | Description                                                                     |
| ------------------------------ | ------------------ | ------------------------------------------------------------------------------- |
| `name`                         | `PitPat Treadmill` | Accessory name shown in HomeKit.                                                |
| `deviceIdentifier`             | required           | Exact CoreBluetooth UUID or BLE adapter identifier.                             |
| `maximumSpeedKph`              | `6`                | Local safety cap from 1.5 to 6.0 km/h. The device-reported limit can reduce it. |
| `debug`                        | `false`            | Enables redacted packet and state logging.                                      |
| `allowRemoteStart`             | `false`            | Permits the motor-start command. Dangerous.                                     |
| `acknowledgeRemoteStartRisk`   | `false`            | Separate risk acknowledgement required for remote start.                        |
| `reconnectInitialDelaySeconds` | `5`                | Initial reconnect delay.                                                        |
| `reconnectMaximumDelaySeconds` | `60`               | Maximum reconnect backoff.                                                      |

## Safety behavior

- Startup never sends a motor command.
- Cached HomeKit state is never used to restart the belt.
- Reconnect never replays a previous command.
- With remote start disabled, speed changes are accepted only while a fresh notification reports that the treadmill is already running.
- A write completing successfully is not treated as command execution. The plugin waits for a subsequent matching status notification.
- Missing, stale, malformed, or checksum-invalid state prevents commands.
- Commands are serialized and time out if no status confirmation arrives.
- The lower of the configured limit, the device-reported limit, and the verified 6.0 km/h BA10-B limit is enforced.

HomeKit does not reliably tell a plugin whether a write came from a person, Siri, or an automation. Enabling remote start therefore also permits automations to start the treadmill. There is no supported way to enable manual HomeKit start while categorically blocking automation start through the same characteristic.

## Bluetooth troubleshooting

### macOS

- Grant Bluetooth permission to the process that runs Homebridge.
- Close the PitPat application on phones and tablets; the treadmill may accept only one central connection.
- Use the CoreBluetooth UUID discovered on the same Mac that runs Homebridge.

### Linux and Raspberry Pi

- Confirm that the Bluetooth adapter is visible and powered.
- The Homebridge service account must have access to the adapter and BlueZ/D-Bus or the selected HCI binding.
- Native BLE dependencies may need build tools during installation.
- Platform support is not yet claimed until BA10-B hardware tests are completed.

### Docker

The container needs access to the host Bluetooth stack or a dedicated HCI adapter. Device mapping and D-Bus configuration vary by host. Docker operation has not yet been verified and is not currently claimed as supported.

### Common messages

- `treadmill ... was not discovered`: verify the exact identifier, power, range, and that the mobile app is closed.
- `FBA1 ... missing`: the connected device does not expose the verified write characteristic.
- `timed out waiting for treadmill confirmation`: the command write completed but the required state notification was not observed; use the physical controls.
- `status is stale`: notifications stopped, so the safety gate rejected the command.

## Development

```bash
npm install
npm run build
npm test
npm run lint
npm run check
npm pack --dry-run
```

The protocol encoder and decoder are pure TypeScript. BLE is behind an adapter interface so automated tests use mocks and never require or contact a treadmill.

## Testing

The automated suite covers:

- BLE command encoding and XOR checksums;
- FBA notification decoding and malformed packets;
- percentage/km/h conversion and 0.1 km/h quantization;
- configured and device-reported limits;
- command confirmation timeout;
- reconnect without command replay;
- safe startup and remote-start rejection.

### Hardware validation procedure

Hardware tests are intentionally separate from the automated suite. Start with passive discovery and notification capture. Validate STOP while the belt is already stopped before any movement test. A movement test must require an explicit operator confirmation, keep the belt clear, use the minimum supported speed for only a few seconds, and keep the physical safety key and power control immediately accessible.

Follow the complete staged procedure in [docs/HARDWARE-TESTING.md](docs/HARDWARE-TESTING.md). The initial BA10-B validation record is in [docs/BA10B-VALIDATION.md](docs/BA10B-VALIDATION.md).

Do not run motor tests unattended or from CI. Never rely on the BLE STOP command as an emergency stop.

## Protocol and attribution

The initial packet structure was reimplemented from the MIT-licensed [`azmke/pitpat-treadmill-control`](https://github.com/azmke/pitpat-treadmill-control) project and then compared with passive BA10-B captures. The BA10-B uses the direct FBA profile rather than that project's FF heartbeat transport. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Publishing

The package is published on [npm](https://www.npmjs.com/package/homebridge-pitpat-treadmill). Future releases use npm Trusted Publishing from GitHub Actions, without a stored npm token. See [docs/PUBLISHING.md](docs/PUBLISHING.md).

## License

MIT. See [LICENSE](LICENSE).

This project is unofficial and is not affiliated with, endorsed by, or supported by PitPat or its manufacturer.
