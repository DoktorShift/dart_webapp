import type { Messages } from "../index"

// English texts for the shell area. Same shape as shell.de.ts.
export const shellEn: Messages["shell"] = {
  tabs: {
    play: "Play",
    leaderboard: "Leaderboard",
    clubs: "Clubs",
    tournaments: "Tournaments",
    profile: "Profile",
  },

  backTo: (screen) => `Back to ${screen}`,

  screens: {
    clubCreate: "Create a club",
    clubInvite: "Invitation",
    scan: "Scan code",
    tournamentCreate: "Create tournament",
    tournament: "Tournament",
    publicProfile: "Player profile",
    pair: "Connect device",
    watch: "Watch",
    board: "Join the board",
  },
  comingSoon: "This is coming in a future version.",
  linkNotYet: "This version can't open this link yet.",
  loadFailed: "This screen couldn't be loaded. Check your connection.",
  retry: "Try again",
  loading: "Loading",
  secretKey: "This is the secret access code of a profile. Anyone who has it can take the profile over. Never give it to anyone or paste it anywhere. It was not used.",

  clubs: {
    emptyTitle: "No clubs yet",
    emptyText: "Create a club for your darts nights, or join one with an invitation.",
    create: "Create a club",
    openInvite: "Scan code",
  },

  tournaments: {
    emptyTitle: "No tournaments yet",
    emptyText: "Create a tournament, or sign up with an invitation.",
    create: "Create tournament",
    openInvite: "Scan code",
  },

  bar: {
    scan: "Scan code",
    more: "More",
    share: "Share",
  },

  scan: {
    intro: "Point the camera at a BlueLine code, paste the link or type the club code.",
    kinds: "Invitations to clubs and tournaments, player profiles and codes to watch or score a game open right away.",
    manualLabel: "Enter link or club code",
    manualPlaceholder: "Link or ABCD-EFGH",
    codeLooking: "Looking up the code",
    codeMissing: "There is no invitation for this code. Check the characters or ask for a new one.",
    codeOffline: "No connection right now. Try again in a moment.",
    invalid: "That's not a BlueLine code. Check that the link is complete.",
    pair: "You connect a device of your own under Profile, not here.",
  },

  scanner: {
    start: "Scan code",
    starting: "Starting the camera",
    hint: "Point the camera at the code.",
    stop: "Stop scanning",
    viewfinder: "Camera view for scanning",
    deniedTitle: "No access to the camera",
    deniedText: "Allow camera access in your browser's settings, or use the field below.",
    noCameraTitle: "No camera found",
    noCameraText: "Use the field below.",
    unavailableTitle: "Scanning isn't possible here",
    unavailableText: "This browser doesn't share the camera. Use the field below.",
    errorTitle: "The camera didn't start",
    errorText: "Another app may be using it.",
    tryAgain: "Try again",
    manualLabel: "Enter code",
    manualPlaceholder: "Code or link",
    submit: "Open",
  },

  qr: {
    label: "QR code",
    share: "Share",
    copy: "Copy link",
    copied: "Copied",
    loadFailed: "The code couldn't be loaded. Check your connection.",
    copyFailed: "Copying didn't work. Press and hold the link to copy it.",
  },
}
