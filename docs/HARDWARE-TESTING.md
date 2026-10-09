# BA10-B hardware validation

Hardware validation is deliberately separate from the automated test suite. Nothing in `npm test` scans for or writes to a treadmill.

## Preconditions

1. Keep people, pets, and loose objects away from the belt.
2. Keep the physical remote, safety key, and mains switch within immediate reach.
3. Close the PitPat application on every nearby phone and tablet.
4. Start with the treadmill powered on and stopped.
5. Use a dedicated Homebridge test instance with `allowRemoteStart` disabled.

## Stage 1: passive validation

- Confirm exact-identifier discovery.
- Confirm `FBA0`, writable `FBA1`, and notifying `FBA2`.
- Observe at least ten stopped-state notifications.
- Confirm every packet's declared length, end byte, and XOR checksum.
- Confirm the reported maximum speed is 6.0 km/h.

This stage must not perform any BLE write.

## Stage 2: STOP while already stopped

This is the first write test and still requires the operator's explicit confirmation.

- Request STOP once.
- Confirm that exactly one 23-byte command is written.
- Confirm that a newer notification reports stopped state and zero speed.
- Disconnect and reconnect; confirm that the command is not replayed.

## Stage 3: telemetry under physical control

Start and adjust the treadmill using its physical control only. Verify current speed, target speed, elapsed time, distance, steps, calories, state transitions, and the 0.1 km/h resolution. Stop using the physical control.

## Stage 4: running-only speed control

Only after Stage 3 passes, start the belt physically at its minimum supported speed and request one 0.1 km/h change from HomeKit. Verify the next notification before making another change. Stop physically if confirmation does not arrive.

## Stage 5: remote start

Remote start is optional and must remain disabled for the initial public validation. If it is ever tested, use an isolated belt, a dedicated test configuration, the lowest supported speed, a maximum run of a few seconds, and a second person ready at the mains switch.

HomeKit cannot reliably distinguish a manual request from an automation. Enabling remote start also enables Siri and automation-triggered start. A BLE STOP command is not an emergency stop.

## Evidence to retain

- OS, hardware architecture, Node.js, Homebridge, and plugin versions.
- Adapter and Bluetooth stack details.
- Redacted GATT inventory.
- Redacted packet captures with serial bytes removed.
- Expected and observed state for every action.
- Whether the physical controls remained functional throughout the test.
