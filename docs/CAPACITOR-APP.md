# Kaaikani Delivery — native app (Capacitor)

The Play Store app is a Capacitor shell around the hosted PWA
(https://deliverypartner.kaaikani.co.in). It replaces the old TWA using the
**same package id** (`in.co.kaaikani.deliverypartner.twa`), so it ships as a
normal update — drivers just update the app.

What the shell adds over the TWA: **background ride tracking**. While a
delivery is active, a native foreground service (persistent "Delivery in
progress" notification) keeps GPS streaming with the screen off or the app
backgrounded — Swiggy/Zomato style. Tracking starts when the driver taps
Start (after a one-time consent sheet) and stops the moment the order is
delivered. Outside rides there is no notification and no background access.

## How it works

```
Play app (Capacitor shell)
 └─ WebView → https://deliverypartner.kaaikani.co.in   (the same PWA)
     ├─ web geolocation watch          — normal use, foreground
     └─ ride active? → BackgroundGeolocation.addWatcher()
         └─ native foreground service → GPS fixes → processFix()
             (same pipeline: odometer, heartbeats, delivery map)
```

Key files:

- `capacitor.config.ts` — appId + `server.url` (remote PWA)
- `android/` — the native project (committed)
- `lib/native-tracking.ts` — plugin wrapper, `isNativeApp()`
- `providers/DriverLocationProvider.tsx` — native watcher lifecycle (start on
  ride, stop on delivery), single `processFix` pipeline for web + native fixes
- `components/location/BackgroundTrackingConsent.tsx` — prominent disclosure
  (required by Play before requesting location for background use)

Because the shell loads the HOSTED site, **web deploys update the app
instantly** — an app-store release is only needed when the native layer
changes (plugins, permissions, icons).

## Build & run locally

```bash
npx cap sync android                       # after changing capacitor config/plugins
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ./gradlew assembleDebug                  # → app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or `npx cap open android` and run from Android Studio.

To test against a dev backend, temporarily change `server.url` in
`capacitor.config.ts` to your ngrok/LAN URL, `npx cap sync android`, rebuild.
**Never commit that change.**

## Release to Play Store

1. **Signing** — the app must be signed with the SAME upload key as the TWA.
   - If you have the TWA's upload keystore (`.jks`/`.keystore` from Bubblewrap
     or PWABuilder): configure it in `android/app/build.gradle` under
     `signingConfigs` (do NOT commit the keystore or passwords).
   - If the keystore is lost: Play Console → Setup → App integrity →
     "Request upload key reset" (possible because Play App Signing is enabled;
     takes a few days).
2. **Bump `versionCode`** in `android/app/build.gradle` (currently 100; must
   always exceed the last Play release).
3. Build the bundle:
   `./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`
4. Upload to Play Console → same app listing → new release.
5. **Background location declaration** (one-time, because the manifest now has
   `ACCESS_BACKGROUND_LOCATION`): Play Console → App content → Sensitive app
   permissions. You'll need:
   - a short video showing the in-app consent sheet + the notification during
     a ride,
   - the explanation: "Delivery partner app — the store tracks the rider's
     location during active deliveries to monitor delivery progress and
     distance; tracking runs only between 'Start delivery' and 'Delivered',
     with a persistent notification."
   - a privacy policy URL that mentions background location collection during
     deliveries.
6. Expect the review of THAT release to take a few extra days.

## Testing checklist (real phone)

- [ ] Login → orders list works (loads the hosted PWA)
- [ ] Start a delivery → consent sheet appears (first time only)
- [ ] Agree → system location prompt → "Delivery in progress" notification appears
- [ ] Screen off for 2 minutes while moving → fleet page marker keeps moving,
      km keeps counting (this is the thing the TWA could not do)
- [ ] Deliver the order → notification disappears
- [ ] Fleet page shows Inactive ~1 min after killing the app mid-ride, and
      ride resume works on reopen (backend `activeRideForMe`)
- [ ] "Not now" on consent → ride still works exactly like the old app
      (foreground-only tracking)

## What background tracking honestly covers

| Situation | Tracking |
|---|---|
| Screen off during a ride | ✅ continues (foreground service keeps the process + WebView alive) |
| App switched / backgrounded | ✅ continues |
| App swiped away from recents | ⚠️ best effort — the service keeps running but the WebView (JS + socket) may be destroyed, so streaming can stop until the app reopens. Resume + backend `activeRideForMe` recover the ride; the fleet page shows the driver's last position and flips to Inactive after 60 s of silence. |
| Force-stop from app settings | ❌ tracking stops (Android kills everything, by design) |

If "swiped away" must keep streaming too, the upgrade path is a native
transport: the Transistorsoft background-geolocation plugin (paid) posts
locations from native code with its own HTTP uploader, independent of the
WebView — the backend's `driverHeartbeat` mutation is already a suitable
ingestion endpoint. Not needed for launch; revisit if field data shows drivers
regularly swiping the app away mid-ride.

### OEM battery killers (important for Indian handsets)

Xiaomi/Redmi, Vivo, Oppo and Realme aggressively kill even foreground
services. For reliable tracking on these phones, driver onboarding must
include:

1. **Battery optimization → "Don't optimize"** for this app (Settings →
   Battery → App battery management, wording varies per OEM).
2. **Autostart / background permission enabled** (MIUI: "Autostart";
   ColorOS/FuntouchOS have equivalents).
3. See https://dontkillmyapp.com for per-brand steps — worth turning into a
   one-page Tamil onboarding sheet for the delivery team.

## Gotchas

- The PWA must be **deployed** (with `lib/native-tracking.ts` + provider
  changes) before the shell can use native tracking — the shell loads the
  hosted site, not local files.
- `android/local.properties` is machine-specific (SDK path) — don't commit.
- The old TWA behavior is unaffected for users who haven't updated; the PWA
  detects the shell at runtime (`isNativeApp()`), so one deployment serves
  browser users, TWA users, and app users.
