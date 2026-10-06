// The badges area's own screens (registered in ./register.ts), for push(). Other areas open a
// badge with push(BADGE_SCREENS.badge, { id: <award event id>, name }).
export const BADGE_SCREENS = {
  list: "badges.list",
  badge: "badges.badge",
  arrange: "badges.arrange",
} as const
