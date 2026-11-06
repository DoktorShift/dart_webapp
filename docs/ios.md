# The iOS app

The App Store app is the website exported as static files inside a Capacitor shell (`ios/`). The
website on Netlify is built exactly as before; nothing here changes it.

## Build and run

Needs macOS with Xcode 26 and Node 22.18+.

```sh
npm run build:ios     # static export into out/ with the iOS flags, then copies it into ios/ (cap sync)
npm run ios           # the same, then opens the project in Xcode: pick a simulator or device, Run
npm run ios:assets    # redraws the app icon and launch image from lib/board-icon.ts (needs Playwright WebKit)
```

`build:ios` sets two build-time variables:

| Variable | iOS value | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_BLUELINE_PLATFORM` | `ios` | `output: "export"`, no service worker, no install card or guide, files and links go to the native share sheet, haptics, no passkeys (WebAuthn needs the https origin), links built on the published site (`lib/platform.ts`) |
| `NEXT_PUBLIC_BLUELINE_FEATURES` | `profile,sync,devices` | First version without payments (App Review 3.1.5 and 5.3), clubs, tournaments, friends, live games and badges (user content needs report and block, 1.2). The tab bar and the leaderboard show only what is on. Override with `BLUELINE_IOS_FEATURES=…` |

## What is set in the Xcode project

- Bundle id `com.aurochssoftware.blueline` (`capacitor.config.ts` and the target): change both if App Store Connect uses another one.
- iOS 16 minimum (CSS container queries), iPhone and iPad, all orientations.
- Display name "BlueLine", languages German (development region) and English.
- Camera and "add to Photos" usage texts in both languages (`App/{de,en}.lproj/InfoPlist.strings`).
- `App/PrivacyInfo.xcprivacy`: no tracking, nothing collected, no required-reason APIs in the app's own code.
- Version: `MARKETING_VERSION` 1.0, `CURRENT_PROJECT_VERSION` 1. Raise the build number for every upload.

## Before submitting

Blocking:

- [ ] **Account deletion (5.1.1(v)).** With the profile on, people create an account. "Sign out and delete everything here" only clears the device; the app also needs to ask the relays to delete the profile's events (NIP-09) and blank its kind 0. Alternative: ship v1 with `BLUELINE_IOS_FEATURES=` (guest only, no account, no network).
- [ ] **Privacy policy** at a public URL (e.g. `https://blueline21.netlify.app/privacy`) and linked in the app (About). It must say what a profile publishes to public Nostr relays.
- [ ] Signing: Apple Developer team in Xcode › Signing & Capabilities, then Product › Archive › Distribute.
- [ ] Test on a real iPhone and iPad: a full game, sharing a result picture, export and import in Settings › Data, creating a profile, pairing a second device with the camera.

App Store Connect:

- [ ] App Privacy answers. With the profile on, name and picture are published to third-party relays at the person's request; decide with that in mind.
- [ ] Export compliance: the app uses standard encryption (NIP-44, NIP-49) for the person's own data. Answer the questions, then set `ITSAppUsesNonExemptEncryption` in Info.plist so it isn't asked on every upload.
- [ ] Screenshots: 6.9" iPhone and 13" iPad; description, keywords and support URL in German and English; age rating.
- [ ] Review notes: no login needed; everything works as a guest.

Later:

- Universal links (`apple-app-site-association` on the site plus Associated Domains) so pairing and profile links open the app.
- Clubs, tournaments, friends and live games with report and block, then add them to `BLUELINE_IOS_FEATURES`.
