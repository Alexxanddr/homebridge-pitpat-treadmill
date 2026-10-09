# PitPat BA10-B validation record

Date: 9 October 2026  
Host: macOS  
Runtime: Node.js 26.10.0  
Plugin version: 0.1.0 development build

Device identifiers and serial-number bytes are intentionally omitted.

## GATT profile

| Role                      | UUID   | Properties   |
| ------------------------- | ------ | ------------ |
| Primary treadmill service | `FBA0` | service      |
| Command                   | `FBA1` | read, write  |
| Status                    | `FBA2` | read, notify |

The device also exposed service `1910` with characteristics `2B10` and `2B11`; they were not required for treadmill control.

## Passive observations

- Notifications arrived approximately once per second without polling.
- Status packets were 53 bytes long, started with `0x66`, declared length `0x35`, ended with `0x43`, and passed the XOR checksum.
- Firmware version: 37 (`0x25`).
- Device type: 5.
- Device-reported maximum speed: 6.0 km/h.
- Stopped state decoded as zero current and target speed.

## Command validation

1. A single STOP command was sent while already stopped. A newer notification confirmed stopped state and 0.0 km/h.
2. A request below the real minimum was clamped by the treadmill to a 1.5 km/h target. The plugin minimum was consequently corrected to 1.5 km/h.
3. Start at 1.5 km/h was requested. Notifications transitioned from stopped, through starting, to running with a 1.5 km/h target.
4. Set speed to 1.6 km/h was requested while running. A newer notification reported a 1.6 km/h target, confirming 0.1 km/h target resolution.
5. STOP was sent in a `finally` path. Notifications transitioned to stopped and subsequently reached 0.0 km/h with a zero target.

No automatic command replay was used. Remote start remains disabled in the default configuration despite successful protocol validation.

## Still unverified

- Long-duration operation and workout-metric accuracy.
- Behavior at every speed through the full 1.5–6.0 km/h range.
- Linux, Raspberry Pi OS, Docker, and Windows hosts.
- Other PitPat models or BA10-B firmware versions.
- Emergency-stop behavior; BLE STOP is not a certified safety mechanism.
