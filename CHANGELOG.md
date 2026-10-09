# Changelog

All notable changes to this project will be documented in this file. The project follows Semantic Versioning.

## [0.1.3] - 2026-10-09

### Fixed

- Attempt one controlled HCI controller reset when Noble remains outside the `poweredOn` state after a BLE link timeout.
- Preserve normal reconnect backoff when the adapter cannot recover.

## [0.1.2] - 2026-10-09

### Fixed

- Always use the hardware-validated 1.5 km/h minimum for remote starts.
- Prevent `RotationSpeed` changes from starting a stopped treadmill.
- Debounce HomeKit speed-slider updates to avoid BLE command floods.
- Handle disconnects during command confirmation without unhandled HomeKit write errors.
- Remove the unsupported `StatusFault` characteristic from the `Fanv2` service.

## [0.1.1] - 2026-10-09

### Changed

- Publish releases through GitHub Actions and npm Trusted Publishing with OIDC provenance.
- Document the automated release procedure.

## [0.1.0] - 2026-10-09

### Added

- Initial Homebridge dynamic platform implementation.
- Local FBA0/FBA1/FBA2 BLE transport for the PitPat BA10-B.
- Notification-based state, speed and workout telemetry decoding.
- Safe-by-default STOP and running-only speed control.
- Explicit double opt-in for remote motor start.
- Mock BLE tests, reconnect handling and publish-ready metadata.
- Hardware validation of passive state, STOP, start at the verified 1.5 km/h minimum, and a 0.1 km/h target-speed change on a BA10-B.
