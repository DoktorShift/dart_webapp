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
    clubCreate: "Start a club",
    clubInvite: "Invitation",
    openInvite: "Open invitation",
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

  clubs: {
    emptyTitle: "No clubs yet",
    emptyText: "Start a club for your darts nights, or join one with an invitation.",
    create: "Start a club",
    openInvite: "Open invitation",
  },

  tournaments: {
    emptyTitle: "No tournaments yet",
    emptyText: "Create a tournament, or sign up with an invitation.",
    create: "Create tournament",
    openInvite: "Open invitation",
  },

  openLink: {
    intro: "Scan the invitation's code or paste its link.",
    manualLabel: "Paste link",
    manualPlaceholder: "Invitation link",
    invalid: "That's not a BlueLine link. Check that it's complete.",
    notClub: "That's not a club invitation.",
    notTournament: "That's not a tournament invitation.",
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
