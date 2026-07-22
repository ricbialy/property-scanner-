# Property Scan iOS

SwiftUI capture app for LiDAR-equipped iPhone/iPad (test hardware: iPhone 15 Pro,
iPad Pro). Captures rooms with RoomPlan, reviews locally, and uploads durable,
checksummed capture bundles.

## Status — IMPORTANT

**Every file in this directory is *source implemented only*: it has never been
compiled.** The development environment for this repository has no macOS, so no
Xcode build has ever run. Expect compile errors on first build (RoomPlan and
SwiftUI API details can only be confirmed against a real SDK) and treat fixing
them as the first task on a Mac — see
`docs/testing/device-testing-guide.md` for the full setup, and set the
repository variable `ENABLE_IOS_CI=true` to compile on GitHub's macOS runners
without owning a Mac.

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
