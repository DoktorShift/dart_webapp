import { MESSAGES } from "@/lib/i18n"
import { SITE, absoluteUrl } from "@/lib/site"

// llms.txt (https://llmstxt.org): a short Markdown guide for AI assistants, plus a full version
// with what the About page says. Written from the English catalog; German is the app's standard.
const t = MESSAGES.en

const header = () =>
  [
    `# ${SITE.name}`,
    "",
    `> ${t.meta.description}`,
    "",
    `${SITE.name} is a progressive web app: it runs in the browser on iPhone, iPad, Android and desktop, can be added to the home screen and keeps score offline. Games, settings and the leaderboard are saved on the device; there is no account, no ads and no tracking. The interface speaks German and English: it follows the device's language and falls back to German.`,
  ].join("\n")

const author = () =>
  ["## Author", "", `- [${SITE.author.name}](${SITE.author.url}): designed and built ${SITE.name}. ${t.meta.freelance(SITE.author.name)}`].join("\n")

export function llmsTxt() {
  return [
    header(),
    "",
    "## Pages",
    "",
    `- [${SITE.name}](${absoluteUrl("/")}): the scorer. 501, 301, 701, Cricket, Cut Throat Cricket and Around the Clock for 1 to 6 players.`,
    `- [About, rules and FAQ](${absoluteUrl("/about")}): what the app does, the rules of each game, installing it, questions and answers.`,
    `- [Full text](${absoluteUrl("/llms-full.txt")}): rules, install steps and answers in one Markdown file.`,
    "",
    author(),
    "",
    "## Optional",
    "",
    `- [Source code on GitHub](${SITE.source})`,
    "",
  ].join("\n")
}

export function llmsFullTxt() {
  const games = [
    t.about.x01,
    ...(["cricket", "cutthroat", "clock"] as const).map((id) => ({ name: t.modes[id].name, rules: t.modes[id].rules({ bullFinish: false }) })),
  ]
  return [
    header(),
    "",
    "## Features",
    "",
    ...t.meta.features.map((feature) => `- ${feature}`),
    "",
    "## Games and rules",
    "",
    ...games.flatMap((game) => [`### ${game.name}`, "", game.rules, ""]),
    "## Install it (works offline once installed)",
    "",
    ...(["ios", "android", "desktop"] as const).flatMap((platform) => [
      `### ${t.install.platforms[platform]}`,
      "",
      ...t.install.steps[platform].map((step, i) => `${i + 1}. **${step.title}**: ${step.text}`),
      "",
    ]),
    "## Questions",
    "",
    ...t.about.faq.flatMap((item) => [`### ${item.q}`, "", item.a, ""]),
    author(),
    "",
    ...t.about.authorNote,
    "",
    `Pages: ${absoluteUrl("/")} and ${absoluteUrl("/about")}. Source: ${SITE.source}`,
    "",
  ].join("\n")
}
