"use client"

import { useEffect, useState, type FormEvent } from "react"
import { CircleHelp, MonitorSmartphone } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { DEVICES_TEXTS } from "@/lib/i18n/features/devices.screens"
import { deviceName, MAX_DEVICE_NAME } from "@/lib/devices/device-name"
import type { DeviceEntry, DeviceList } from "@/lib/devices/list"
import { useSession } from "@/lib/profile/session"
import { SCREENS } from "@/lib/shell/registry"

// Profil › Geräte (P2.03): the profile's devices as the person keeps them (lib/devices/list.ts),
// "Eigenes Gerät hinzufügen", and what to do about a lost one. The list is an overview, and
// says so: removing a device here takes nothing from it.
export default function DevicesScreen() {
  const session = useSession()
  if (!session) return null
  return <Devices key={session.pubkey} pubkey={session.pubkey} />
}

const loadList = () => import("@/lib/devices/list")

function Devices({ pubkey }: { pubkey: string }) {
  const t = useT()
  const l = useAreaT(DEVICES_TEXTS).list
  const nav = useNav()
  const [list, setList] = useState<DeviceList | null>(null)
  const [round, setRound] = useState(0)
  const [editing, setEditing] = useState<DeviceEntry | null>(null)
  const [lostOpen, setLostOpen] = useState(false)

  // The first device of a profile puts itself in when the list first opens; then the list as
  // the relays have it.
  useEffect(() => {
    let alive = true
    void loadList()
      .then(async ({ addThisDevice, loadDeviceList }) => {
        await addThisDevice(pubkey, deviceName()).catch(() => {})
        return loadDeviceList(pubkey)
      })
      .then(
        (next) => alive && setList(next),
        () => alive && setList({ entries: [], thisDevice: "", state: "unavailable", available: false }),
      )
    return () => {
      alive = false
    }
  }, [pubkey, round])

  const reload = () => setRound((n) => n + 1)
  const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(t.intl, { day: "numeric", month: "long", year: "numeric" })
  const footer = !list ? undefined : !list.available ? l.notYet : list.state === "complete" ? undefined : list.state === "partial" ? l.partial : l.unavailable

  return (
    <>
      <Group title={l.devices} footer={footer}>
        {!list ? (
          <ListRow title={l.loading} />
        ) : (
          list.entries.map((device) => (
            <ListRow key={device.id} title={device.name} subtitle={device.id === list.thisDevice ? l.thisDevice : l.since(date(device.added))} onClick={() => setEditing(device)} />
          ))
        )}
      </Group>

      <Group>
        <ListRow icon={MonitorSmartphone} iconTone="green" title={l.add} subtitle={l.addHint} onClick={() => nav.push(SCREENS.devicesPair)} />
        <ListRow icon={CircleHelp} iconTone="gray" title={l.lost} onClick={() => setLostOpen(true)} />
      </Group>
      <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{l.footer}</p>

      {editing && <EditSheet key={editing.id} pubkey={pubkey} device={editing} isThis={editing.id === list?.thisDevice} onClose={() => setEditing(null)} onChanged={reload} />}

      <Sheet open={lostOpen} onOpenChange={setLostOpen} title={l.lostTitle}>
        <SheetBody>
          <ol className="grid gap-3 pl-5 text-[1.0625rem] leading-snug [&>li]:list-decimal">
            {l.lostSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </SheetBody>
        <Button onClick={() => setLostOpen(false)} className="mt-4 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem] font-semibold">
          {l.lostDone}
        </Button>
      </Sheet>
    </>
  )
}

// One device: a new name, or out of the list (with the honest word that the device keeps what
// it has).
function EditSheet({ pubkey, device, isThis, onClose, onChanged }: { pubkey: string; device: DeviceEntry; isThis: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT()
  const l = useAreaT(DEVICES_TEXTS).list
  const [name, setName] = useState(device.name)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [removing, setRemoving] = useState(false)

  const run = async (change: (list: Awaited<ReturnType<typeof loadList>>) => Promise<void>) => {
    setBusy(true)
    setFailed(false)
    try {
      await change(await loadList())
      onChanged()
      onClose()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || name.trim() === device.name) return onClose()
    void run(({ renameDevice }) => renameDevice(pubkey, device.id, name))
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={device.name} description={isThis ? l.thisDevice : undefined}>
      <form onSubmit={save}>
        <TextField label={l.nameLabel} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_DEVICE_NAME} autoCapitalize="words" enterKeyHint="done" className="mt-2" />
        {failed && (
          <InlineStatus tone="error" className="mt-4">
            {l.failed}
          </InlineStatus>
        )}
        <Button type="submit" disabled={busy || !name.trim()} className="mt-4 h-12 w-full rounded-2xl text-[1.0625rem] font-semibold">
          {busy ? l.saving : l.save}
        </Button>
      </form>
      <Button variant="ghost" disabled={busy} onClick={() => setRemoving(true)} className="mt-2 h-12 w-full rounded-2xl text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
        {l.remove}
      </Button>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{l.removeTitle(device.name)}</AlertDialogTitle>
            <AlertDialogDescription>{l.removeText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-danger text-white hover:bg-danger/90" onClick={() => void run(({ removeDevice }) => removeDevice(pubkey, device.id))}>
              {l.removeConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}
