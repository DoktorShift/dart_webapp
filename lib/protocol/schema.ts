// A small schema language for BlueLine content: each schema checks a parsed JSON value (and
// returns it typed) and describes itself as JSON Schema, so docs/protocol/schemas/ is generated
// from the same definitions the app validates with. Strings count Unicode code points, like
// JSON Schema's maxLength.

export type JsonSchema = { [key: string]: unknown }

export class SchemaError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path || "content"}: ${message}`)
    this.name = "SchemaError"
    this.path = path
  }
}

export interface Schema<T, Optional extends boolean = false> {
  readonly optional: Optional
  check(value: unknown, path: string): T
  json(): JsonSchema
}

export type Infer<S> = S extends Schema<infer T, boolean> ? T : never

type AnySchema = Schema<unknown, boolean>
type Shape = Record<string, AnySchema>
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends Schema<unknown, true> ? K : never }[keyof S]
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>
type Simplify<T> = { [K in keyof T]: T[K] } & {}
export type ObjectOf<S extends Shape> = Simplify<
  { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined> }
>

const fail = (path: string, message: string): never => {
  throw new SchemaError(path, message)
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const codePoints = (s: string) => Array.from(s).length

const make = <T>(check: (value: unknown, path: string) => T, json: () => JsonSchema): Schema<T> => ({
  optional: false,
  check,
  json,
})

export function str(opts: { min?: number; max: number; pattern?: RegExp; description?: string }): Schema<string> {
  const min = opts.min ?? 0
  return make(
    (v, path) => {
      if (typeof v !== "string") return fail(path, "expected a string")
      const n = codePoints(v)
      if (n < min) fail(path, `shorter than ${min}`)
      if (n > opts.max) fail(path, `longer than ${opts.max}`)
      if (opts.pattern && !opts.pattern.test(v)) fail(path, `does not match ${opts.pattern.source}`)
      return v
    },
    () => ({
      type: "string",
      ...(min > 0 ? { minLength: min } : {}),
      maxLength: opts.max,
      ...(opts.pattern ? { pattern: opts.pattern.source } : {}),
      ...(opts.description ? { description: opts.description } : {}),
    }),
  )
}

// Lowercase hex of an exact byte length: event ids and pubkeys (32), object ids (16).
export const hex = (bytes: number, description?: string) =>
  str({ min: bytes * 2, max: bytes * 2, pattern: new RegExp(`^[0-9a-f]{${bytes * 2}}$`), description })

export const id32 = (description?: string) => hex(32, description)

export function int(min: number, max: number, description?: string): Schema<number> {
  return make(
    (v, path) => {
      if (typeof v !== "number" || !Number.isSafeInteger(v)) return fail(path, "expected an integer")
      if (v < min || v > max) fail(path, `outside ${min}…${max}`)
      return v
    },
    () => ({ type: "integer", minimum: min, maximum: max, ...(description ? { description } : {}) }),
  )
}

// Unix seconds. 2^32 keeps it inside what every relay stores.
export const time = (description?: string) => int(0, 4294967295, description)

export function bool(description?: string): Schema<boolean> {
  return make(
    (v, path) => (typeof v === "boolean" ? v : fail(path, "expected true or false")),
    () => ({ type: "boolean", ...(description ? { description } : {}) }),
  )
}

export function oneOf<const T extends string | number>(values: readonly T[], description?: string): Schema<T> {
  return make(
    (v, path) => (values.includes(v as T) ? (v as T) : fail(path, `expected one of ${values.join(", ")}`)),
    () => ({ enum: [...values], ...(description ? { description } : {}) }),
  )
}

export function arr<T>(item: Schema<T, boolean>, opts: { min?: number; max: number; unique?: boolean; description?: string }): Schema<T[]> {
  const min = opts.min ?? 0
  return make(
    (v, path) => {
      if (!Array.isArray(v)) return fail(path, "expected a list")
      if (v.length < min) fail(path, `fewer than ${min} entries`)
      if (v.length > opts.max) fail(path, `more than ${opts.max} entries`)
      const out = v.map((x, i) => item.check(x, `${path}[${i}]`))
      if (opts.unique && new Set(out.map((x) => JSON.stringify(x))).size !== out.length) fail(path, "entries repeat")
      return out
    },
    () => ({
      type: "array",
      items: item.json(),
      ...(min > 0 ? { minItems: min } : {}),
      maxItems: opts.max,
      ...(opts.unique ? { uniqueItems: true } : {}),
      ...(opts.description ? { description: opts.description } : {}),
    }),
  )
}

export function opt<T>(schema: Schema<T, boolean>): Schema<T | undefined, true> {
  return {
    optional: true,
    check: (v, path) => (v === undefined ? undefined : schema.check(v, path)),
    json: () => schema.json(),
  }
}

export function nullable<T>(schema: Schema<T, boolean>): Schema<T | null> {
  return make(
    (v, path) => (v === null ? null : schema.check(v, path)),
    () => ({ anyOf: [schema.json(), { type: "null" }] }),
  )
}

// Objects ignore unknown fields by default: a newer writer may add optional fields within the
// same format version. Handshake messages use { strict: true } so nothing rides along unseen.
export function obj<S extends Shape>(shape: S, opts: { strict?: boolean; description?: string } = {}): Schema<ObjectOf<S>> {
  const keys = Object.keys(shape)
  return make(
    (v, path) => {
      if (!isPlainObject(v)) return fail(path, "expected an object")
      if (opts.strict) for (const k of Object.keys(v)) if (!(k in shape)) fail(path ? `${path}.${k}` : k, "unknown field")
      const out: Record<string, unknown> = {}
      for (const k of keys) {
        const s = shape[k]
        const p = path ? `${path}.${k}` : k
        if (v[k] === undefined && !s.optional) fail(p, "missing")
        const value = s.check(v[k], p)
        if (value !== undefined) out[k] = value
      }
      return out as ObjectOf<S>
    },
    () => ({
      type: "object",
      properties: Object.fromEntries(keys.map((k) => [k, shape[k].json()])),
      required: keys.filter((k) => !shape[k].optional),
      additionalProperties: !opts.strict,
      ...(opts.description ? { description: opts.description } : {}),
    }),
  )
}

// Any JSON object up to a size, for payloads another module defines (profile package, private
// record data). Its own module validates the inside.
export function anyObject(maxBytes: number, description?: string): Schema<Record<string, unknown>> {
  return make(
    (v, path) => {
      if (!isPlainObject(v)) return fail(path, "expected an object")
      if (utf8Length(JSON.stringify(v)) > maxBytes) fail(path, `larger than ${maxBytes} bytes`)
      return v
    },
    () => ({ type: "object", description: description ?? `Any JSON object up to ${maxBytes} bytes` }),
  )
}

// A schema that also checks a condition across fields (e.g. "until after from").
export function refine<T>(schema: Schema<T>, test: (value: T) => string | null): Schema<T> {
  return make(
    (v, path) => {
      const value = schema.check(v, path)
      const problem = test(value)
      if (problem) fail(path, problem)
      return value
    },
    () => schema.json(),
  )
}

export const utf8Length = (s: string) => new TextEncoder().encode(s).length

// Absolute https URL for pictures and links in public content; nothing else is ever loaded.
export const httpsUrl = (max = 512) => str({ max, pattern: /^https:\/\/[^\s"<>\\]+$/, description: "https URL" })
