// The tournaments area's own screens (registered in ./register.ts), for push(). The shell's
// own ids (tournament.create, tournament.view, tournament.openInvite) are in lib/shell/registry.ts.
export const TOURNAMENT_SCREENS = {
  organize: "tournament.organize",
  board: "tournament.board",
  tv: "tournament.tv",
  print: "tournament.print",
} as const
