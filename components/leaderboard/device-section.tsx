"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Ellipsis, SlidersHorizontal } from "lucide-react"
import { Confirm } from "@/components/ui/confirm"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Sheet, SheetBody, SheetActions } from "@/components/ui/sheet"
import { Menu, type MenuItem } from "@/components/ui/menu"
import { Dartboard } from "@/components/dartboard"
import { NavBarItems } from "@/components/nav/nav-bar-items"
import { useNav } from "@/components/nav/nav-context"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { useT } from "@/components/i18n-provider"
import { MatchRow } from "@/components/leaderboard/match-row"
import { StandingRow } from "@/components/leaderboard/standing-row"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { useOwnProfile } from "@/components/profile/use-profile"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { periodBounds, type Period } from "@/lib/calendar"
import { playedElsewhere } from "@/lib/profile/history"
import { formatPercent } from "@/lib/i18n"
import { computeStandings, STANDINGS_MIN_GAMES, useMatchHistory, type Standing, type StandingsFilter, type StandingsSort } from "@/lib/leaderboard"
import { hasScreen } from "@/lib/shell/registry"
import { inSelection } from "@/lib/storage/stats"
import { playerLinkAliases } from "@/lib/storage/player-links"
import { sameNames } from "@/lib/storage/players"
import { cn } from "@/lib/utils"

// "Hier gespielt": the games against others on this device, ranked by win rate from a minimum
// of games (E19), for a game type and a period; the sentence under the controls says exactly
// what is counted. One profile is one row, empty seats are nobody, imported results are marked.
// Your own row is tinted; when it sits far down, a line on top says where you stand (Game
// Center shows the local player's entry apart from the list). Every row opens the player.

const FILTERS: StandingsFilter[] = ["all", "x01", "cricket", "clock"]
const PERIODS: Period[] = ["today", "days30", "year", "all"]
const SORTS: StandingsSort[] = ["winRate", "wins", "average"]
// An evening needs fewer games for a rank than a year.
const MIN_GAMES: Record<Period, number> = { today: 2, days30: STANDINGS_MIN_GAMES, year: STANDINGS_MIN_GAMES, all: STANDINGS_MIN_GAMES }
// From this position on, the line "Du: Platz 7" shows above the list.
const SHOWN_WITHOUT_LINE = 5
const RECENT_GAMES = 5

export function DeviceSection() {
  const t = useT()
  const l = t.leaderboard
  const nav = useNav()
  useRegistryVersion()
  const { matches, players, aliases, links, loaded, clear } = useMatchHistory()
  const own = useOwnProfile()
  const [filter, setFilter] = useState<StandingsFilter>("all")
  const [period, setPeriod] = useState<Period>("all")
  const [sortBy, setSortBy] = useState<StandingsSort>("winRate")
  const [confirmReset, setConfirmReset] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const listsRef = useRef<HTMLDivElement>(null)

  const ownKey = own?.key ?? null
  const sameAs = useMemo(() => playerLinkAliases(links, own?.sameAs, matches, aliases, players ?? []), [links, own?.sameAs, matches, aliases, players])
  const showAverage = filter === "all" || filter === "x01"
  // Cricket and Clock have no Ø 3 Darts: that sort isn't offered, and a chosen one falls back.
  const sorts = showAverage ? SORTS : SORTS.filter((s) => s !== "average")
  const sort = sorts.includes(sortBy) ? sortBy : "winRate"
  const bounds = useMemo(() => periodBounds(period), [period])
  const standings = useMemo(
    () => computeStandings(matches, { type: filter, ...bounds, sortBy: sort, minGames: MIN_GAMES[period], aliases, sameAs }),
    [matches, filter, bounds, sort, period, aliases, sameAs],
  )
  const recent = useMemo(() => matches.filter((m) => inSelection(m, { type: filter, ...bounds, scope: "versus" })).slice(0, RECENT_GAMES), [matches, filter, bounds])
  // Games the profile played on another device count here too: say so.
  const fromElsewhere = useMemo(() => playedElsewhere(matches, own?.session.pubkey ?? null, own?.player?.id), [matches, own?.session.pubkey, own?.player?.id])

  const rows = [...standings.ranked, ...standings.unranked]
  const profileOf = (s: Standing) => players?.find((p) => p.id === s.playerId)?.pubkey
  const names = useProfileNames(rows.map(profileOf).filter((p): p is string => !!p))
  // Two rows of one name (a guest seat and a profile, say): both say which one they are.
  const twins = sameNames(rows.map((s) => ({ id: s.key, name: s.name })))
  const hintOf = (s: Standing) => (twins.has(s.key) ? (profileOf(s) ? l.withProfile : l.guestHere) : null)
  const opens = hasScreen(PROFILE_SCREENS.player)
  const open = (s: Standing) => (opens ? () => nav.push(PROFILE_SCREENS.player, { key: s.key, name: s.name }) : undefined)
  const mine = ownKey ? rows.find((s) => s.key === ownKey) : undefined
  const myIndex = mine ? standings.ranked.indexOf(mine) : -1
  const showMyLine = !!mine && (myIndex < 0 || myIndex >= SHOWN_WITHOUT_LINE)
  const scrollToMe = () => listsRef.current?.querySelector<HTMLElement>("[data-you]")?.scrollIntoView({ block: "center", behavior: "smooth" })
  // The line stays pinned under the bar while the own row is out of view (Game Center keeps the
  // local player's entry on screen), and steps aside once the row itself can be seen.
  const [myRowVisible, setMyRowVisible] = useState(false)
  useEffect(() => {
    const row = listsRef.current?.querySelector<HTMLElement>("[data-you]")
    if (!row || !showMyLine) return
    const observer = new IntersectionObserver(([entry]) => setMyRowVisible(entry.isIntersecting), { threshold: 0.6 })
    observer.observe(row)
    return () => observer.disconnect()
  }, [showMyLine, standings])
  const filtered = filter !== "all" || period !== "all"
  const showAll = () => {
    setFilter("all")
    setPeriod("all")
  }

  const menu: MenuItem[] = [
    ...sorts.map((s) => ({ id: s, label: l.sorts[s], checked: sort === s, onSelect: () => setSortBy(s) })),
    { id: "reset", label: t.settings.reset, destructive: true, onSelect: () => setConfirmReset(true) },
  ]

  return (
    <>
      <NavBarItems>
        <Menu icon={Ellipsis} label={l.more} items={menu} />
      </NavBarItems>
      <Button variant="secondary" onClick={() => setFiltersOpen(true)} className="mt-3 min-h-11 gap-2 rounded-xl text-primary">
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {l.filters[filter]} · {l.periods[period]}
      </Button>
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title={l.filter}>
        <SheetBody>
          <p className="mb-2 text-sm text-muted-foreground">{l.filter}</p>
          <ChoiceList label={l.filter} options={FILTERS.map((f) => ({ value: f, title: l.filters[f] }))} value={filter} onChange={setFilter} />
          <p className="mb-2 mt-4 text-sm text-muted-foreground">{l.period}</p>
          <ChoiceList label={l.period} options={PERIODS.map((p) => ({ value: p, title: l.periods[p] }))} value={period} onChange={setPeriod} />
        </SheetBody>
        <SheetActions><Button onClick={() => setFiltersOpen(false)} className="h-12 w-full">{t.common.done}</Button></SheetActions>
      </Sheet>

      {loaded && rows.length === 0 ? (
        <EmptyState
          art={<Dartboard variant="mini" highlight={() => 0.25} className="h-20 w-20" />}
          title={l.emptyTitle}
          description={filter === "all" && period === "all" ? l.emptyAll : l.emptyFilter}
          primary={{ label: l.emptyAction, onClick: () => nav.openSetup("x01") }}
          secondary={filtered ? { label: l.emptyShowAll, onClick: showAll } : undefined}
        />
      ) : (
        loaded && (
          <>


            {showMyLine && mine && (
              <button
                type="button"
                onClick={scrollToMe}
                className={cn(
                  "sticky top-[calc(2.75rem+env(safe-area-inset-top)+0.5rem)] z-10 mt-3 flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2 text-left text-[0.9375rem] font-medium text-primary backdrop-blur-xl transition-[opacity,background-color] active:bg-primary/15",
                  myRowVisible && "pointer-events-none opacity-0",
                )}
                aria-hidden={myRowVisible || undefined}
              >
                <span>{mine.rank === null ? l.yourPlaceUnranked : l.yourPlace(mine.rank)}</span>
                <span className="tabular-nums">
                  {mine.rank === null ? l.gamesWins(mine.games, mine.wins) : formatPercent(t, mine.winRate)}
                </span>
              </button>
            )}

            <div ref={listsRef}>
              {standings.ranked.length > 0 && (
                <ol aria-label={l.sections.device} className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                  {standings.ranked.map((s) => (
                    <StandingRow key={s.key} standing={s} sortBy={sort} showAverage={showAverage} you={s.key === ownKey} picture={names(profileOf(s) ?? "").picture} hint={hintOf(s)} onClick={open(s)} />
                  ))}
                </ol>
              )}

              {standings.unranked.length > 0 && (
                <Group title={l.unranked} footer={l.minGames(standings.minGames)}>
                  <ol className="divide-y divide-border">
                    {standings.unranked.map((s) => (
                      <StandingRow key={s.key} standing={s} sortBy={sort} showAverage={showAverage} you={s.key === ownKey} picture={names(profileOf(s) ?? "").picture} hint={hintOf(s)} onClick={open(s)} />
                    ))}
                  </ol>
                </Group>
              )}
            </div>

            {rows.some((s) => s.imported || s.includesImported) && (
              <p className="mt-3 px-1 text-[0.8125rem] text-muted-foreground">
                {rows.some((s) => s.imported) && `* ${t.data.importedTag}`}
                {rows.some((s) => s.imported) && rows.some((s) => !s.imported && s.includesImported) && " · "}
                {rows.some((s) => !s.imported && s.includesImported) && `† ${t.data.withImportedTag}`}
              </p>
            )}
            <p className="mt-3 px-1 text-[0.8125rem] leading-snug text-muted-foreground">
              {l.scope(l.scopePeriods[period], standings.games, rows.length, rows.some((s) => s.imported || s.includesImported))} {l.rankedBy[sort]} {l.minGames(standings.minGames)}
              {fromElsewhere && ` ${l.otherDevices}`}
              {standings.withEmptySeat > 0 && ` ${l.emptySeats(standings.withEmptySeat)}`}
            </p>
            {recent.length > 0 && (
              <Group title={l.recent}>
                {recent.map((match) => (
                  <MatchRow key={match.id} match={match} />
                ))}
              </Group>
            )}
          </>
        )
      )}

      <Confirm
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t.settings.resetTitle}
        text={t.settings.resetDescription(matches.length)}
        confirm={t.settings.resetConfirm}
        destructive
        onConfirm={clear}
      />
    </>
  )
}
