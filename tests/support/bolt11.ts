// Builds signed BOLT-11 invoices for tests (no Lightning node, no network): amount, creation time,
// expiry, payment hash and a description hash, signed with a throwaway node key.
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bech32 } from "@scure/base"

export interface InvoiceFields {
  amountMsat?: number
  timestamp: number
  expirySeconds?: number
  paymentHash: Uint8Array
  descriptionHash?: Uint8Array
  description?: string
  nodeKey: Uint8Array
}

const numberToWords = (value: number, length?: number) => {
  const words: number[] = []
  let rest = value
  do {
    words.unshift(rest % 32)
    rest = Math.floor(rest / 32)
  } while (rest > 0)
  while (length !== undefined && words.length < length) words.unshift(0)
  return words
}

const tagged = (type: number, data: number[]) => [type, Math.floor(data.length / 32), data.length % 32, ...data]

// 5-bit words to bytes, zero-padded to a byte boundary (what BOLT-11 signs).
function wordsToPaddedBytes(words: number[]): Uint8Array {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const word of words) {
    buffer = (buffer << 5) | word
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  if (bits > 0) bytes.push((buffer << (8 - bits)) & 0xff)
  return Uint8Array.from(bytes)
}

export function encodeInvoice(fields: InvoiceFields): string {
  let amount = ""
  if (fields.amountMsat !== undefined) amount = fields.amountMsat % 100 === 0 ? `${fields.amountMsat / 100}n` : `${fields.amountMsat * 10}p`
  const hrp = `lnbc${amount}`
  const data = [...numberToWords(fields.timestamp, 7), ...tagged(1, bech32.toWords(fields.paymentHash))]
  if (fields.descriptionHash) data.push(...tagged(23, bech32.toWords(fields.descriptionHash)))
  if (fields.description !== undefined) data.push(...tagged(13, bech32.toWords(new TextEncoder().encode(fields.description))))
  if (fields.expirySeconds !== undefined) data.push(...tagged(6, numberToWords(fields.expirySeconds)))
  const message = new Uint8Array([...new TextEncoder().encode(hrp), ...wordsToPaddedBytes(data)])
  const signature = secp256k1.sign(sha256(message), fields.nodeKey)
  const sigBytes = new Uint8Array([...signature.toCompactRawBytes(), signature.recovery])
  return bech32.encode(hrp, [...data, ...bech32.toWords(sigBytes)], 2000)
}
