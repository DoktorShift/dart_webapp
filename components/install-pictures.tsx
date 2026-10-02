import type { ReactNode } from "react"
import {
  BookmarkPlus,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  EllipsisVertical,
  History,
  Lock,
  MonitorDown,
  Plus,
  Settings,
  Share,
  SquarePlus,
  Star,
  WifiOff,
} from "lucide-react"
import { useT } from "@/components/i18n-provider"
import type { Messages } from "@/lib/i18n"
import type { InstallPicture } from "@/lib/install"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"

// Simple drawings of the screens in each install step, with a pulsing ring on what to tap.
// They are sketches of the idea, not copies of any browser's exact look.

const host = new URL(SITE.url).host

// The thing to tap: a ring that pulses (still under Reduce Motion).
function Spot({ children, round = true, className }: { children: ReactNode; round?: boolean; className?: string }) {
  const shape = round ? "rounded-full" : "rounded-lg"
  return (
    <span className={cn("relative inline-flex items-center justify-center", className)}>
      <span className={cn("absolute -inset-1.5 bg-primary/25 motion-safe:animate-ping", shape)} />
      <span className={cn("absolute -inset-1.5 ring-2 ring-primary", shape)} />
      <span className="relative">{children}</span>
    </span>
  )
}

function AppIcon({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- a tiny static icon inside a drawing
  return <img src="/icon/192" alt="" className={cn("rounded-[22%]", className)} />
}

// A phone, cropped so only its top or bottom part shows.
function Phone({ edge, children }: { edge: "top" | "bottom"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "absolute left-1/2 flex h-[135%] w-[46%] min-w-[11rem] -translate-x-1/2 flex-col overflow-hidden border-[5px] border-foreground/80 bg-background shadow-xl",
        edge === "bottom" ? "bottom-3 rounded-b-[1.75rem] border-t-0" : "top-3 rounded-t-[1.75rem] border-b-0",
      )}
    >
      {children}
    </div>
  )
}

// A browser window on a computer screen.
function Window({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-[7%] bottom-[-12%] top-[12%] overflow-hidden rounded-xl border border-border bg-background shadow-xl">
      <div className="flex h-6 items-center gap-1.5 border-b border-border bg-secondary/60 px-2.5">
        <span className="h-2 w-2 rounded-full bg-danger/70" />
        <span className="h-2 w-2 rounded-full bg-warning/70" />
        <span className="h-2 w-2 rounded-full bg-success/70" />
        <span className="ml-3 h-4 w-28 rounded-t-md bg-background" />
      </div>
      {children}
    </div>
  )
}

function AddressBar({ action }: { action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
      <div className="flex h-6 flex-1 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[0.6875rem] text-muted-foreground">
        <Lock className="h-3 w-3" />
        {host}
        <span className="ml-auto flex items-center gap-2.5">
          {action}
          <Star className="h-3.5 w-3.5" />
        </span>
      </div>
      <EllipsisVertical className="h-4 w-4 text-muted-foreground" />
    </div>
  )
}

// A hint of the app behind sheets and dialogs.
function PageBehind() {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 px-3 pt-4 opacity-60">
      <span className="font-display text-sm font-semibold">{SITE.name}</span>
      <AppIcon className="h-14 w-14 rounded-full" />
      <span className="h-5 w-full rounded-md bg-primary/60" />
    </div>
  )
}

function Row({ icon: Icon, label, strong }: { icon: typeof Copy; label: string; strong?: boolean }) {
  return (
    <span className={cn("flex h-7 w-full items-center justify-between gap-3 px-2.5 text-[0.6875rem]", strong && "font-semibold")}>
      {label}
      <Icon className="h-3.5 w-3.5 shrink-0" />
    </span>
  )
}

const PICTURES: Record<InstallPicture, (words: Messages["install"]["picture"]) => ReactNode> = {
  "ios-share": () => (
    <Phone edge="bottom">
      <PageBehind />
      <div className="mx-2.5 mb-1.5 flex h-6 items-center justify-center rounded-lg bg-secondary text-[0.625rem] text-muted-foreground">{host}</div>
      <div className="flex h-9 items-center justify-around px-1 text-primary">
        <ChevronLeft className="h-4 w-4" />
        <ChevronRight className="h-4 w-4 opacity-40" />
        <Spot>
          <Share className="h-4 w-4" />
        </Spot>
        <BookOpen className="h-4 w-4" />
        <Copy className="h-4 w-4" />
      </div>
    </Phone>
  ),
  "ios-add": (words) => (
    <Phone edge="bottom">
      <PageBehind />
      <div className="space-y-1 rounded-t-2xl border-t border-border bg-card p-2 pb-3 shadow-[0_-8px_24px_rgba(0,0,0,0.25)]">
        <Row icon={Copy} label={words.copy} />
        <Row icon={BookmarkPlus} label={words.addBookmark} />
        <Spot round={false} className="flex w-full">
          <Row icon={SquarePlus} label={words.addToHome} strong />
        </Spot>
        <Row icon={Star} label={words.addToFavourites} />
      </div>
    </Phone>
  ),
  "ios-confirm": (words) => (
    <Phone edge="top">
      <div className="flex items-center justify-between gap-2 whitespace-nowrap px-3 pb-2 pt-3 text-[0.625rem]">
        <span className="text-primary">{words.cancel}</span>
        <span className="min-w-0 overflow-hidden font-semibold">{words.addToHome}</span>
        <Spot round={false}>
          <span className="px-1 font-semibold text-primary">{words.add}</span>
        </Spot>
      </div>
      <div className="mx-2.5 flex items-center gap-2.5 rounded-xl bg-card p-2.5">
        <AppIcon className="h-10 w-10" />
        <div className="min-w-0 flex-1 text-[0.6875rem]">
          <p className="border-b border-border pb-1.5 font-medium">{SITE.shortName}</p>
          <p className="pt-1.5 text-muted-foreground">{words.homeScreenName}</p>
        </div>
      </div>
      <div className="mx-2.5 mt-2 flex items-center justify-between rounded-xl bg-card px-2.5 py-2 text-[0.6875rem]">
        {words.openAsWebApp}
        <span className="flex h-4 w-7 items-center justify-end rounded-full bg-success p-0.5">
          <span className="h-3 w-3 rounded-full bg-white" />
        </span>
      </div>
    </Phone>
  ),
  "home-screen": (words) => (
    <Phone edge="top">
      <div className="grid grid-cols-4 gap-x-3 gap-y-3 px-3 pt-5">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="aspect-square rounded-[22%] bg-secondary" />
        ))}
        <span className="flex flex-col items-center gap-1">
          <Spot round={false}>
            <AppIcon className="h-9 w-9" />
          </Spot>
          <span className="text-[0.5625rem] font-medium">{SITE.shortName}</span>
        </span>
        <span className="aspect-square rounded-[22%] bg-secondary" />
      </div>
      <span className="mx-auto mt-4 flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[0.625rem] font-semibold text-success">
        <WifiOff className="h-3 w-3" />
        {words.worksOffline}
      </span>
    </Phone>
  ),
  "android-menu": () => (
    <Phone edge="top">
      <div className="flex items-center gap-2 px-2.5 pb-2 pt-3">
        <div className="flex h-6 flex-1 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[0.625rem] text-muted-foreground">
          <Lock className="h-3 w-3" />
          {host}
        </div>
        <Spot>
          <EllipsisVertical className="h-4 w-4" />
        </Spot>
      </div>
      <PageBehind />
    </Phone>
  ),
  "android-install": (words) => (
    <Phone edge="top">
      <div className="relative flex-1">
        <PageBehind />
        <div className="absolute right-2 top-2 w-[72%] space-y-0.5 rounded-xl border border-border bg-card py-1.5 shadow-xl">
          <Row icon={Plus} label={words.newTab} />
          <Row icon={History} label={words.history} />
          <Spot round={false} className="flex w-full">
            <Row icon={Download} label={words.installApp} strong />
          </Spot>
          <Row icon={Settings} label={words.settings} />
        </div>
      </div>
    </Phone>
  ),
  "android-confirm": (words) => (
    <Phone edge="top">
      <div className="relative flex-1">
        <PageBehind />
        <div className="absolute inset-x-3 top-6 rounded-2xl bg-card p-3 shadow-xl">
          <div className="flex items-center gap-2.5">
            <AppIcon className="h-9 w-9" />
            <div className="text-[0.6875rem]">
              <p className="font-semibold">{words.installApp}</p>
              <p className="text-muted-foreground">{SITE.name}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-3 text-[0.6875rem] font-semibold text-primary">
            <span className="px-1">{words.cancel}</span>
            <Spot round={false}>
              <span className="px-1">{words.install}</span>
            </Spot>
          </div>
        </div>
      </div>
    </Phone>
  ),
  "desktop-install": () => (
    <Window>
      <AddressBar
        action={
          <Spot>
            <MonitorDown className="h-3.5 w-3.5 text-foreground" />
          </Spot>
        }
      />
      <PageBehind />
    </Window>
  ),
  "desktop-confirm": (words) => (
    <Window>
      <AddressBar action={<MonitorDown className="h-3.5 w-3.5 text-primary" />} />
      <div className="relative flex-1">
        <PageBehind />
        <div className="absolute right-3 top-2 w-56 rounded-xl border border-border bg-card p-3 shadow-xl">
          <p className="text-[0.75rem] font-semibold">{words.installQuestion}</p>
          <div className="mt-2 flex items-center gap-2 text-[0.6875rem]">
            <AppIcon className="h-7 w-7" />
            {SITE.name}
          </div>
          <div className="mt-3 flex justify-end gap-2 text-[0.6875rem] font-semibold">
            <span className="rounded-md px-2 py-1 text-primary">{words.cancel}</span>
            <Spot round={false}>
              <span className="rounded-md bg-primary px-2 py-1 text-primary-foreground">{words.install}</span>
            </Spot>
          </div>
        </div>
      </div>
    </Window>
  ),
  "desktop-dock": (words) => (
    <>
      <div className="absolute inset-x-[16%] top-[10%] h-[52%] rounded-xl border border-border bg-background/70 p-3 shadow-xl">
        <div className="flex items-center gap-2 text-[0.6875rem] font-semibold">
          <AppIcon className="h-5 w-5" />
          {SITE.name}
        </div>
        <span className="mt-3 flex w-fit items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[0.625rem] font-semibold text-success">
          <WifiOff className="h-3 w-3" />
          {words.worksOffline}
        </span>
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-end gap-2.5 rounded-2xl border border-border bg-card/80 px-3 py-2 shadow-xl backdrop-blur">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="h-8 w-8 rounded-[22%] bg-secondary" />
        ))}
        <Spot round={false}>
          <AppIcon className="h-8 w-8" />
        </Spot>
        <span className="h-8 w-8 rounded-[22%] bg-secondary" />
      </div>
    </>
  ),
}

export function InstallPictureFrame({ picture }: { picture: InstallPicture }) {
  const t = useT()
  const words = t.install.picture
  return (
    <div
      role="img"
      aria-label={words.labels[picture]}
      className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-[radial-gradient(circle_at_50%_30%,hsl(var(--primary)/0.18),transparent_65%)] bg-secondary/40 text-foreground"
    >
      {PICTURES[picture](words)}
    </div>
  )
}
