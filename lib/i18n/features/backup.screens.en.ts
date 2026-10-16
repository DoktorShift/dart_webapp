import type { Widen } from "../index.ts"
import type { backupScreensDe } from "./backup.screens.de.ts"

// English texts of the backup area's screens. Same shape as backup.screens.de.ts.
export const backupScreensEn: Widen<typeof backupScreensDe> = {
  row: {
    secured: "Backed up",
    notSecured: "Not backed up yet",
    passkeyOnly: "Passkey set up",
    signer: "In your signer app",
  },

  hint: {
    text: "Not backed up yet.",
    action: "Back up now",
    later: "Later",
    laterLabel: "Hide this hint for 30 days",
  },

  screen: {
    securedTitle: "Your profile is backed up.",
    securedText: (date) => `Backup file from ${date}. Keep the file and its password safe.`,
    notSecuredTitle: "Your profile isn't backed up yet.",
    notSecuredText: "If this device is lost, your profile is gone. A backup file brings it back.",
    passkeyOnlyText: "Your passkey alone isn't enough: if it is lost, your profile is gone. Create a backup file as well.",
    signerTitle: "Your access lives in your signer app.",
    signerText: "Back it up there. BlueLine needs no backup of its own for it.",
    methods: "Backups",
    file: "Backup file",
    fileNew: "Create backup file",
    fileAgain: "Create a new backup file",
    fileHint: "A file and a password for your password manager",
    fileDate: (date) => `Created on ${date}`,
    passkey: "Passkey",
    passkeyNew: "Set up passkey",
    passkeyHint: "With Face ID, Touch ID or your password manager",
    passkeyDate: (date) => `Set up on ${date}`,
    passkeyUnconfirmed: "Not confirmed yet",
    footer: "A backup holds your access. Your games come along by themselves on a new device.",
  },

  fileSheet: {
    title: "Backup file",
    preparing: "Preparing",
    passwordLabel: "Your password",
    passwordHint: "Save it in your password manager now. It is kept nowhere else; without it the file is useless.",
    copy: "Copy password",
    copied: "Copied",
    save: "Save file",
    share: "Share file",
    saved: "Your profile is backed up.",
    savedHint: "Keep the file where you will find it again, such as your cloud or an email to yourself.",
    failed: "The backup couldn't be created. Try again.",
    retry: "Try again",
    done: "Done",
  },

  passkeySheet: {
    title: "Passkey",
    text: "Your device will ask for Face ID, Touch ID or your password manager. With the passkey you open your profile on a new device later.",
    note: "A passkey alone is not a complete backup: if it is lost, your profile is gone.",
    start: "Set up passkey",
    working: "Setting up",
    done: "Passkey set up.",
    doneUnconfirmed: "Passkey set up. The backup isn't confirmed yet; it will be checked again the next time you open this.",
    unsupported: "That doesn't work on this device. Use the backup file.",
    cancelled: "Cancelled. You can try again any time.",
    failed: "That didn't work. Try again or use the backup file.",
    close: "Close",
  },

  restore: {
    intro: "With your backup file and its password, or with your passkey.",
    fileTitle: "Backup file",
    chooseFile: "Choose file",
    passwordLabel: "Password",
    passwordPlaceholder: "xxxxx-xxxxx-xxxxx-xxxxx",
    open: "Open profile",
    opening: "Opening",
    passkeyTitle: "Passkey",
    passkey: "Open with passkey",
    wrongPassword: "The password doesn't match this file.",
    notBackup: "That is not a BlueLine backup file.",
    newer: "This backup is from a newer version of the app. Update the app.",
    damaged: "The file is damaged or incomplete.",
    notFound: "No backup was found for this passkey.",
    offline: "The backup couldn't be loaded. Check the connection.",
    passkeyUnsupported: "That doesn't work with this device. Use your backup file.",
    cancelled: "Cancelled.",
    failed: "That didn't work. Try again.",
  },

  arrived: {
    done: "Your profile is here.",
    doneText: "You are now signed in here too.",
    signerTitle: "Almost there",
    signerText: "Your profile lives in a signer app. Connect it on this device too; your access stays there.",
    signerConnect: "Connect signer app",
    finish: "Done",
  },

  history: {
    loading: "Loading your games",
    complete: "Your games are here.",
    partial: "Not all games could be loaded.",
    unavailable: "Your games couldn't be loaded yet.",
    retry: "Try again",
  },
}
