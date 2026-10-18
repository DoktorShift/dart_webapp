"use client"

// P0.02 component gallery, for visual checks only. Not part of the app: copy it to
// app/dev-gallery/page.tsx, run `npx next dev -p 3203`, open /dev-gallery, delete it again.
import { Ban, Info, Settings, Smartphone, Trash2 } from "lucide-react"
import { QRCodeView } from "@/components/common/qr-code-view"
import { QRScanner } from "@/components/common/qr-scanner"
import { ShareActions } from "@/components/common/share-actions"
import { Avatar } from "@/components/ui/avatar"
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"

const LINK = "https://blueline21.netlify.app/#club=3f9a1c0d2b7e4a65"

export default function Gallery() {
  return (
    <div data-gallery className="h-full overflow-y-auto">
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-[max(env(safe-area-inset-top),1rem)]">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Bausteine</h1>

        <Group title="Avatar">
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <Avatar seed="blueline-guest" size={64} />
            <Avatar seed="Lena" name="Lena" size={64} />
            <Avatar seed="Maximilian-Alexander" name="Maximilian-Alexander" size={48} />
            <Avatar seed="3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" size={48} />
            <Avatar seed="7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e" size={40} />
            <Avatar seed="Özlem" name="Özlem" size={40} />
            <Avatar seed="broken" name="Bruno" src="https://invalid.invalid/picture.png" size={40} label="Bruno" />
            <Avatar seed="svg" name="Sven" src="https://example.com/picture.svg" size={32} />
            <Avatar seed="http" name="Hanna" src="http://example.com/picture.png" size={32} />
          </div>
        </Group>

        <Group title="Zeilen" footer="Lange Texte brechen um, nichts wird mit Auslassungspunkten gekürzt.">
          <ListRow icon={Settings} iconTone="gray" title="Einstellungen" onClick={() => {}} />
          <ListRow icon={Smartphone} title="Von meinem anderen Gerät" subtitle="Mit einem Code verbinden" onClick={() => {}} />
          <ListRow title="Gespeicherte Spiele" value="128" />
          <ListRow title="Spielername" value="Maximilian-Alexander von Hohenzollern-Sigmaringen" />
          <ListRow icon={Info} iconTone="teal" title="Ein sehr langer Zeilentitel, der auf einem kleinen Telefon in zwei Zeilen umbrechen muss" onClick={() => {}} />
          <ListRow icon={Ban} iconTone="orange" title="Deaktiviert" onClick={() => {}} disabled />
          <ListRow icon={Trash2} iconTone="red" title="Verbindung entfernen" destructive onClick={() => {}} />
        </Group>

        <Group title="QR-Code">
          <div className="px-4 py-5">
            <QRCodeView value={LINK} caption="Zeig diesen Code deinem Mitspieler." label="QR-Code der Einladung" share={{ url: LINK, title: "Einladung" }} />
          </div>
        </Group>

        <Group title="Teilen">
          <div className="px-4 py-4">
            <ShareActions url={LINK} title="Einladung" />
          </div>
        </Group>

        <Group title="Leerzustand">
          <EmptyState icon={Info} title="Noch nichts da" description="Ein Satz, der erklärt, was hier erscheinen wird." primary={{ label: "Anlegen", onClick: () => {} }} secondary={{ label: "Einladung öffnen", onClick: () => {} }} className="pb-8" />
        </Group>

        <Group title="Scanner">
          <div className="px-4 py-4">
            <QRScanner onResult={(text) => `Gelesen: ${text}`} />
          </div>
        </Group>
      </main>
    </div>
  )
}
