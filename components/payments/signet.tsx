import { cn } from "@/lib/utils"

// The payment signet (PLAN.md "Gestaltungsprinzipien, Sprache und Zahlungssignet"): the original
// Bitcoin mark (bitboy, bitcoin.design) and the original NWC mark (nwc.dev), as one compact
// horizontal unit, Bitcoin left, optically the same size. Both SVGs are embedded unchanged from
// docs/ux/blueline-comfort-prototype.html and drawn as images, so their ids and styles stay their
// own. With a text next to it that says the same, it is decorative; on its own it is one image
// with one label. It never stands for a recipient, an amount or an action.

const BITCOIN = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Vrstva_1" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 144 145">
  <!-- Generator: Adobe Illustrator 29.4.0, SVG Export Plug-In . SVG Version: 2.1.0 Build 152)  -->
  <defs>
    <style>
      .st0 {
        fill: #fff;
      }

      .st1 {
        fill: #f7931a;
      }
    </style>
  </defs>
  <path class="st1" d="M141.845993,89.6650009c-9.6209869,38.5709915-48.6898956,62.0459976-87.2698898,52.4280014C16.0121002,132.4759979-7.46593,93.4079971,2.1570699,54.8390007,11.7711,16.2639999,50.8431015-7.2140098,89.4101028,2.4029901c38.5748978,9.6170104,62.0519028,48.6880095,52.4358902,87.2620108Z"/>
  <path class="st0" d="M48.3110008,84.375c-.3920021.9720001-1.3850021,2.4309998-3.6210022,1.8769989.0790024.1139984-5.7449989-1.4329987-5.7449989-1.4329987l-3.9199982,9.0410004,10.2799988,2.5629959c1.9109993.4790039,3.7879982.9790039,5.632,1.4530029l-3.2670021,13.1269989,7.8910027,1.9690018,3.2369995-12.9869995c2.1580009.5839996,4.25,1.125,6.2980003,1.6340027l-3.2260017,12.9259949,7.8999977,1.9690018,3.2700043-13.1019974c13.4729996,2.5479965,23.6039963,1.5199966,27.8659973-10.663002,3.4370041-9.8099976-.1699982-15.4690018-7.2579956-19.1600037,5.1609955-1.1899948,9.0509949-4.5859985,10.0879974-11.5979958,1.4329987-9.5820007-5.862999-14.7310028-15.8379974-18.1669998l3.2350006-12.9780006-7.8990021-1.9689999-3.151001,12.6359997c-2.0790024-.5180016-4.2099991-1.0060005-6.3310013-1.4890022l3.1709976-12.7199974-7.8939972-1.9690018-3.2389984,12.9760017-15.9309998-3.9459991-2.1020012,8.4369965s5.8610001,1.3430023,5.7369995,1.427002c3.2000008.7989998,3.7770004,2.9160004,3.6809998,4.5940018l-8.8639984,35.5519981ZM85.6869965,87.302002c-2.4440002,9.810997-18.9599991,4.5069962-24.317997,3.1759949l4.3380013-17.3889999c5.3549957,1.3350067,22.5299988,3.9810028,19.9799957,14.2130051ZM88.1269989,61.8499985c-2.2259979,8.9240036-15.9749985,4.3889999-20.4349976,3.2770004l3.9319992-15.7719994c4.4589996,1.1119995,18.8239975,3.1870003,16.5029984,12.4949989Z"/>
</svg>`

const NWC = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none"><path fill="url(#a)" d="M13.826 3.884a3.28 3.28 0 0 0-4.632.018L.948 12.178a3.234 3.234 0 0 0 .02 4.594l13.521 13.522a3.274 3.274 0 0 0 4.627-.016l4.02-4.019c-1.173 1.172-2.137.33-3.28-.809l-2.242-2.241c-1.702.673-3.69.339-5.07-1.037l-1.708-1.709a.57.57 0 0 1-.18-.427q0-.121.047-.235a.6.6 0 0 1 .137-.195l.966-.967-2.104-2.104c-.33-.33-.383-.86-.089-1.219a.89.89 0 0 1 1.317-.065l2.133 2.131 1.445-1.444-2.11-2.104c-.33-.33-.383-.86-.086-1.221a.89.89 0 0 1 1.317-.065l2.141 2.127.908-.908a.6.6 0 0 1 .188-.14.61.61 0 0 1 .67.134l1.712 1.707a4.73 4.73 0 0 1 1.08 5.026l2.243 2.242c1.143 1.138 2.1 1.988 3.272.816l5.071-5.072c-1.219 1.22-2.22.28-3.425-.923z"/><path fill="#897FFF" d="m23.413 1.628-4.311 4.308 9.578 9.578c.917.913 1.714 1.64 2.598 1.288.511-.204.862-.758.666-1.272C27.361 3.503 27.36 3.503 26.751 2.188c-.608-1.314-2.318-1.593-3.338-.56"/><path fill="#897FFF" d="m23.413 1.628-4.311 4.308 9.578 9.578c.917.913 1.714 1.64 2.598 1.288.511-.204.862-.758.666-1.272C27.361 3.503 27.36 3.503 26.751 2.188c-.608-1.314-2.318-1.593-3.338-.56"/><path fill="#897FFF" d="m23.413 1.628-4.311 4.308 9.578 9.578c.917.913 1.714 1.64 2.598 1.288.511-.204.862-.758.666-1.272C27.361 3.503 27.36 3.503 26.751 2.188c-.608-1.314-2.318-1.593-3.338-.56"/><path fill="#897FFF" d="m23.413 1.628-4.311 4.308 9.578 9.578c.917.913 1.714 1.64 2.598 1.288.511-.204.862-.758.666-1.272C27.361 3.503 27.36 3.503 26.751 2.188c-.608-1.314-2.318-1.593-3.338-.56"/><path fill="#897FFF" d="m23.413 1.628-4.311 4.308 9.578 9.578c.917.913 1.714 1.64 2.598 1.288.511-.204.862-.758.666-1.272C27.361 3.503 27.36 3.503 26.751 2.188c-.608-1.314-2.318-1.593-3.338-.56"/><defs><linearGradient id="a" x1="15.457" x2="15.457" y1="1.306" y2="31.243" gradientUnits="userSpaceOnUse"><stop stop-color="#FFCA4A"/><stop offset="1" stop-color="#F7931A"/></linearGradient></defs></svg>`

const source = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`
const BITCOIN_SRC = source(BITCOIN)
const NWC_SRC = source(NWC)

// The prototype's proportions: the NWC mark a touch smaller, so both read the same size.
const SIZES = {
  small: { unit: "gap-0.5", bitcoin: "h-5 w-5", nwc: "h-4.75 w-4.75" },
  large: { unit: "gap-1.5", bitcoin: "h-13 w-13", nwc: "h-12.25 w-12.25" },
}

export function PaymentSignet({ size = "small", label, className }: { size?: keyof typeof SIZES; label?: string; className?: string }) {
  const s = SIZES[size]
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("inline-flex shrink-0 items-center", s.unit, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- inline originals, nothing to optimize */}
      <img src={BITCOIN_SRC} alt="" className={cn("object-contain", s.bitcoin)} draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element -- inline originals, nothing to optimize */}
      <img src={NWC_SRC} alt="" className={cn("object-contain", s.nwc)} draggable={false} />
    </span>
  )
}
