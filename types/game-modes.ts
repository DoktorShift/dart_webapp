// The games the app can score. Names, descriptions and rules are in the language catalogs
// (lib/i18n), under `modes`, keyed by these ids. The Play tab groups them by type: 301, 501 and
// 701 are X01; Cut Throat is a Cricket rule (see lib/game/rules.ts).

export type ModeId = "301" | "501" | "701" | "clock" | "cricket" | "cutthroat"
