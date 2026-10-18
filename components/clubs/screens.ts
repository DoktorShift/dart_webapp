// The clubs area's own screens (registered in ./register.ts), for push(). Every one takes the
// club's id as params.club and its name as params.name (for the title and the back button).
export const CLUB_SCREENS = {
  view: "club.view",
  members: "club.members",
  table: "club.table",
  dates: "club.dates",
  manage: "club.manage",
  season: "club.season",
  discover: "club.discover",
} as const
