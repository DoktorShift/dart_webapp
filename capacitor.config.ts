import type { CapacitorConfig } from "@capacitor/cli"

// The iOS app: the static export of the website (npm run build:ios writes out/) inside a native
// shell. Setup, signing and submission: docs/ios.md.
const config: CapacitorConfig = {
  // Must match the bundle identifier registered in App Store Connect.
  appId: "com.aurochssoftware.blueline",
  appName: "BlueLine Darts",
  webDir: "out",
  ios: {
    // The pages draw under the status bar and home indicator themselves (viewport-fit=cover and
    // env(safe-area-inset-*)), as the installed web app does.
    contentInset: "never",
    // The app's dark background behind the page while it loads and when it bounces.
    backgroundColor: "#020817",
    // Long-press previews of links belong to Safari, not to a scorer.
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#020817",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
    },
  },
}

export default config
