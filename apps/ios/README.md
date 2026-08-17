# Property Scan iOS

SwiftUI capture app for LiDAR-equipped iPhone/iPad (test hardware: iPhone 15 Pro,
iPad Pro). Captures rooms with RoomPlan, reviews locally, and uploads durable,
checksummed capture bundles.

## Status — IMPORTANT

**Status: Compiled and unit-tested on the iOS Simulator via CI — never run on
a physical device.** The `ios` CI job (macos-15, Xcode 16, iPhone 16 Pro
simulator) builds the app and runs the XCTest suite on every push. RoomPlan
capture itself cannot execute in the simulator, so scanning, upload-resume
behaviour on a jobsite, and measurement quality remain unverified until a real
LiDAR device runs it — see `docs/testing/device-testing-guide.md`. To pause the
macOS CI job (paid minutes), set repository variable `DISABLE_IOS_CI=true`.

## What the source implements

Written (not compiled, not device-tested):

- capability gating (`DeviceCapability`) — unsupported devices get a precise
  message, never fake capture;
- deep-link handoff parsing (`propertyscan://scan?token=…`) — the token is an
  opaque short-lived handoff credential, not an API secret, and is redeemed
  once against `POST /v1/scan-handoff/redeem`;
- the capture state machine mirroring the server lifecycle;
- capture manifest construction with SHA-256 checksums matching the
  `@propertyscan/contracts` manifest schema (v1.0);
- an offline-first upload queue skeleton with resumable, idempotent semantics;
- a RoomPlan capture controller shell using `RoomCaptureView`/`RoomCaptureSession`.

Not yet implemented: multiroom structure building UX, opening photo capture,
local review UI polish, and real background-transfer uploads. Do not claim this
app is field-ready.

## Building

This directory intentionally contains no `.xcodeproj`. Generate it locally:

```bash
brew install xcodegen
cd apps/ios
xcodegen generate
open PropertyScan.xcodeproj
```

Set your development team in Xcode's Signing & Capabilities pane (or via
`DEVELOPMENT_TEAM` in a local, uncommitted `project.local.yml`). Never commit
certificates, provisioning profiles, or team identifiers.

Simulator note: RoomPlan requires LiDAR hardware; on the simulator the app runs
but capture is gated off with the unsupported-device message. Unit tests
(state machine, manifest, checksums) run fine on the simulator.
