# Real-device testing guide (iPhone 15 Pro / LiDAR iPad Pro)

**Honest status first:** the iOS app is _source implemented_ but has **never been
compiled** — the development environment for this repository has no macOS.
Expect to fix compile errors on first build (RoomPlan/SwiftUI API details can
only be validated against a real Xcode SDK). A Mac is **mandatory** for building;
alternatives are listed at the end.

## 1. Requirements

- A Mac with **Xcode 16 or newer** (iOS 17 SDK minimum; the project targets iOS 17.0).
- An **Apple Developer account** (free account works for 7-day personal builds;
  paid account needed for TestFlight).
- **iPhone 15 Pro** or any LiDAR device (iPhone 12 Pro+, iPad Pro 2020+) on iOS 17+.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`.
- This repository cloned on the Mac, plus a machine running the backend
  (`make test-demo` — can be the same Mac).

## 2. Generate and open the project

```bash
cd apps/ios
xcodegen generate
open PropertyScan.xcodeproj
```

## 3. Signing and bundle identifier

In Xcode → target _PropertyScan_ → _Signing & Capabilities_:

1. Set **Team** to your Apple Developer team.
2. Change the bundle identifier from the placeholder
   `com.propertyscan.dev.PropertyScan` to something unique to you
   (e.g. `com.yourname.propertyscan`).
   Never commit certificates, profiles, or your team ID.

## 4. Point the app at your backend

The phone must reach the API over your LAN. Find your Mac/server's LAN IP
(`ipconfig getifaddr en0`), then start the backend bound to it:

```bash
API_BASE_URL=http://<LAN-IP>:4000 WEB_BASE_URL=http://<LAN-IP>:3000 make test-demo
```

Configure the same base URL in the app (build setting/Info.plist entry
`API_BASE_URL` — wire this during first compile; the API client takes it as
`PropertyScanAPIClient(baseURL:)`). iOS blocks plain HTTP by default: for LAN
testing add an ATS exception for your IP, or serve HTTPS.

## 5. Create a scan session and hand off

1. Open `http://<LAN-IP>:3000`, pick the demo organization/property, press
   **Start scan session**.
2. A `propertyscan://scan?token=…` deep link appears. On the phone, open it via
   QR code (make a QR of the link) or paste it in Notes and tap it.
3. The app redeems the token (single-use, 15-minute expiry) and loads the session.

## 6. Scan two or more connected rooms

- Start near a doorway; move slowly along walls and openings.
- Complete each room, name it, then scan the next connected room.
- Review the room list locally; delete/rename before upload.

## 7. Interrupt and resume an upload

1. Start the upload, then enable Airplane Mode mid-transfer.
2. The upload queue persists the bundle and progress; re-enable connectivity
   and retry — only missing chunks are re-sent (`GET .../uploads/{id}` shows
   received/missing parts; you can watch it from the browser status panel).

## 8. Review and correct in the browser

Open the plan link from the dashboard (session list → _Review floor plan_):
rename rooms, fix opening sizes (inches), remove false openings, add missed
ones, press **Verify…** with laser/tape after checking a dimension, **Save
corrections**, then **Accept revision**.

## 9. Compare against laser/tape

Use `docs/testing/field-validation-worksheet.md` + `field-validation.csv`.
Record RoomPlan's value _before_ correcting it.

## 10. Reporting bugs safely

Attach: app version + commit (status panel), device model + iOS version, the
scan session ID, the JSON from `GET /v1/scan-sessions/{id}` and
`GET /v1/plans/{id}`, and `.local/logs/*.log` from the server. Do **not** share
capture bundles or photos from real properties without the owner's consent —
they reveal interior layouts.

## No Mac? Two alternatives

1. **GitHub-hosted macOS CI** — set repository variable `ENABLE_IOS_CI=true`;
   every PR then compiles the app and runs unit tests on a macOS runner
   (simulator only — proves it builds, cannot scan). This is the fastest way to
   drive the code to _Compiled_ status without owning a Mac.
2. **TestFlight** — requires a paid Apple Developer account and a one-time
   macOS build (a cloud Mac such as MacStadium/Scaleway works). Once archived
   and uploaded, testers install over the air with no Mac involved.
