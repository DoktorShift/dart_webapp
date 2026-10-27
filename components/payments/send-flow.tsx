"use client"

import { useMemo, useState } from "react"
import { ScanLine } from "lucide-react"
import { PersonRow } from "@/components/common/person-row"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useAreaT, useT } from "@/components/i18n-provider"
import { useFriends } from "@/components/friends/use-friends"
import { AmountPicker } from "@/components/payments/amount-picker"
import { PayFlow } from "@/components/payments/pay-flow"
import { SheetActions } from "@/components/payments/sheet-actions"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { byState } from "@/lib/friends/model"
import { formatDate } from "@/lib/i18n"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { actions } from "@/lib/payments/journal"
import type { Amount } from "@/lib/payments/money"
import { useSession } from "@/lib/profile/session"
import { useArchive } from "@/lib/storage/hooks"

// "Senden" from Zahlungen: whom first (friends, then the people played with here, each paid by
// the address in their profile), the amount next, then the review (./pay-flow.tsx). A payment
// code from someone's "Empfangen" is scanned from the bottom of the list.

type Person = { pubkey: string; name: string; picture: string | null; subtitle?: string }
// `action` is made once, when the payment is set off: a new one on each render would let the
// journal lose track of it (and of a second tap).
type Step = { kind: "who" } | { kind: "amount"; person: Person } | { kind: "pay"; person: Person; amount: Amount; action: string } | { kind: "scan"; action: string }

// How many people from the games on this device are offered.
const RECENT = 6

export function SendFlow({ onDone }: { onDone: () => void }) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const s = tx.send
  const session = useSession()
  const me = session?.pubkey ?? null
  const { friends } = useFriends()
  const { matches } = useArchive()
  const friendKeys = useMemo(() => (friends ? byState(friends, "friend").map((f) => f.pubkey) : []), [friends])
  // The people with a profile in the games here, newest game first, apart from me and friends.
  const recent = useMemo(() => {
    const seen = new Set<string>(friendKeys)
    if (me) seen.add(me)
    const people: Person[] = []
    for (const match of matches) {
      for (const player of match.players) {
        if (!player.pubkey || seen.has(player.pubkey)) continue
        seen.add(player.pubkey)
        people.push({ pubkey: player.pubkey, name: player.name, picture: null, subtitle: s.lastPlayed(formatDate(t, Date.parse(match.finishedAt) || Date.now())) })
        if (people.length >= RECENT) return people
      }
    }
    return people
  }, [matches, friendKeys, me, s, t])
  const names = useProfileNames([...friendKeys, ...recent.map((p) => p.pubkey)])
  const [step, setStep] = useState<Step>({ kind: "who" })
  const [amount, setAmount] = useState<Amount | null>(null)

  const cancel = (
    <Button variant="ghost" onClick={onDone} className="h-12 w-full rounded-xl text-[1.0625rem]">
      {t.common.cancel}
    </Button>
  )

  switch (step.kind) {
    case "who": {
      const friendRows = friendKeys.map((pubkey) => ({ pubkey, name: names(pubkey).name ?? pubkey.slice(0, 8), picture: names(pubkey).picture }))
      const recentRows = recent.map((person) => ({ ...person, picture: names(person.pubkey).picture }))
      return (
        <>
          {friendRows.length > 0 && (
            <Group title={s.friends} className="first:mt-0">
              {friendRows.map((person) => (
                <PersonRow key={person.pubkey} pubkey={person.pubkey} name={person.name} picture={person.picture} onClick={() => setStep({ kind: "amount", person })} />
              ))}
            </Group>
          )}
          {recentRows.length > 0 && (
            <Group title={s.recent} className="first:mt-0">
              {recentRows.map((person) => (
                <PersonRow key={person.pubkey} pubkey={person.pubkey} name={person.name} picture={person.picture} subtitle={person.subtitle} onClick={() => setStep({ kind: "amount", person })} />
              ))}
            </Group>
          )}
          <Group footer={s.scanHint} className="first:mt-0">
            <ListRow icon={ScanLine} iconTone="orange" title={s.scan} onClick={() => setStep({ kind: "scan", action: actions.single() })} />
          </Group>
          <SheetActions>{cancel}</SheetActions>
        </>
      )
    }
    case "amount":
      return (
        <>
          <PersonRow pubkey={step.person.pubkey} name={step.person.name} picture={step.person.picture} />
          <div className="mt-2">
            <AmountPicker label={s.amount} value={amount} onChange={setAmount} />
          </div>
          <SheetActions>
            <Button disabled={amount === null} onClick={() => amount && setStep({ kind: "pay", person: step.person, amount, action: actions.single() })} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
              {t.common.next}
            </Button>
            {cancel}
          </SheetActions>
        </>
      )
    case "pay":
      return <PayFlow action={step.action} once counterpart={{ name: step.person.name, pubkey: step.person.pubkey }} amount={step.amount} onDone={onDone} />
    case "scan":
      return <PayFlow action={step.action} once counterpart={{ name: "" }} amount={null} route={{ kind: "scan" }} onDone={onDone} />
  }
}
