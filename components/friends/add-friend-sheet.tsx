"use client"

import { useState } from "react"
import { QrCode, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetActions, SheetBody } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { PersonRow } from "@/components/common/person-row"
import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { useRecentPlayers } from "@/components/common/use-recent-players"
import { useAreaT, useT } from "@/components/i18n-provider"
import { FRIENDS_TEXTS } from "@/lib/i18n/features/friends.screens"
import { friendsProblem } from "@/components/friends/problems"
import { useFriends } from "@/components/friends/use-friends"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { findFriend } from "@/lib/friends/model"
import { requestFriend } from "@/lib/friends/service"
import { readProfileCode } from "@/lib/profile/profile-link"
import { useSession } from "@/lib/profile/session"
import { SITE } from "@/lib/site"

type Person = { pubkey: string; relays: readonly string[] }
type Outcome = { name: string; published: boolean }

// "Freund hinzufügen": the people this device played with lately (with a profile, not on the
// list yet), the scanner for a profile code, and one's own code for the other direction. One
// tap sends the request; the sheet says whether it went out or waits for a connection, and stays
// open with the rest of the list for the next one. Closed, it forgets everything.
export function AddFriendSheet({ open, onOpenChange, onShowCode }: { open: boolean; onOpenChange: (open: boolean) => void; onShowCode: () => void }) {
  const t = useT()
  const tx = useAreaT(FRIENDS_TEXTS)
  const session = useSession()
  const { friends } = useFriends()
  const { players, loaded } = useRecentPlayers({ withProfile: true })
  const known = (pubkey: string) => !!friends && findFriend(friends, pubkey) !== null
  const candidates = players.filter((p) => p.pubkey && !known(p.pubkey)).slice(0, 8)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<Person | null>(null)
  const names = useProfileNames([...candidates.map((p) => p.pubkey as string), ...(scanned ? [scanned.pubkey] : [])])
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const nameOf = (pubkey: string, fallback?: string) => names(pubkey).name ?? fallback ?? tx.unnamed

  const close = (next: boolean) => {
    if (!next) {
      setScanning(false)
      setScanned(null)
      setBusy(null)
      setProblem(null)
      setOutcome(null)
    }
    onOpenChange(next)
  }

  const add = async (person: Person, name: string) => {
    setBusy(person.pubkey)
    setProblem(null)
    setOutcome(null)
    try {
      const { published } = await requestFriend(person.pubkey, person.relays)
      setOutcome({ name, published: published !== false })
      setScanned(null)
    } catch (error) {
      setProblem(friendsProblem(tx, error))
    } finally {
      setBusy(null)
    }
  }

  const onScan = async (text: string): Promise<ScanVerdict> => {
    const address = await readProfileCode(text, [window.location.origin, SITE.url])
    if (!address) return tx.notProfile
    if (address.pubkey === session?.pubkey) return tx.isYou
    if (known(address.pubkey)) return tx.already(nameOf(address.pubkey))
    setScanning(false)
    setScanned({ pubkey: address.pubkey, relays: address.relays })
  }

  const sendButton = (person: Person, name: string, primary: boolean) => (
    <Button variant={primary ? "default" : "secondary"} onClick={() => void add(person, name)} disabled={busy !== null} aria-label={tx.sendFor(name)} className={primary ? "h-11 rounded-full px-4 text-[0.9375rem] font-semibold" : "h-11 rounded-full px-4 text-[0.9375rem] font-semibold text-primary"}>
      {tx.send}
    </Button>
  )

  return (
    <Sheet open={open} onOpenChange={close} title={tx.addTitle} description={scanning ? undefined : tx.addText}>
      <SheetBody>
        {busy && (
          <p role="status" aria-live="polite" className="mt-2 px-1 text-[0.9375rem] text-muted-foreground">
            {tx.sending(nameOf(busy))}
          </p>
        )}
        {outcome && (
          <InlineStatus tone={outcome.published ? "success" : "info"} className="mt-2">
            {outcome.published ? tx.sentTo(outcome.name) : tx.queued(outcome.name)}
          </InlineStatus>
        )}
        {problem && (
          <InlineStatus tone="error" className="mt-2">
            {problem}
          </InlineStatus>
        )}
        {scanning ? (
          <>
            <QRScanner className="mt-2" onResult={onScan} manualLabel={tx.scanManual} />
            <Button variant="ghost" onClick={() => setScanning(false)} className="mt-3 h-11 w-full rounded-xl text-[1.0625rem] text-primary">
              {tx.back}
            </Button>
          </>
        ) : scanned ? (
          <>
            <Group title={tx.scanned} className="mt-2">
              <PersonRow pubkey={scanned.pubkey} name={nameOf(scanned.pubkey)} picture={names(scanned.pubkey).picture} action={sendButton(scanned, nameOf(scanned.pubkey), true)} />
            </Group>
            <Button variant="ghost" onClick={() => setScanned(null)} className="mt-3 h-11 w-full rounded-xl text-[1.0625rem] text-primary">
              {tx.back}
            </Button>
          </>
        ) : (
          <>
            <Group className="mt-2">
              <ListRow icon={ScanLine} iconTone="blue" title={tx.scan} onClick={() => setScanning(true)} />
              <ListRow
                icon={QrCode}
                iconTone="teal"
                title={tx.myCode}
                onClick={() => {
                  close(false)
                  onShowCode()
                }}
              />
            </Group>
            {loaded && candidates.length === 0 && <p className="mt-4 px-4 text-[0.8125rem] text-muted-foreground">{tx.noRecent}</p>}
            {candidates.length > 0 && <Group title={tx.recent}>
              {candidates.map((p) => {
                const pubkey = p.pubkey as string
                const name = nameOf(pubkey, p.name)
                return <PersonRow key={pubkey} pubkey={pubkey} name={name} picture={names(pubkey).picture} action={sendButton({ pubkey, relays: [] }, name, false)} />
              })}
            </Group>}
          </>
        )}
      </SheetBody>
      <SheetActions>
        <Button variant="ghost" onClick={() => close(false)} className="h-12 w-full rounded-2xl text-[1.0625rem]">
          {t.common.done}
        </Button>
      </SheetActions>
    </Sheet>
  )
}
