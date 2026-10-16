// Where a pairing in progress keeps its state (./pairing.ts owns it): entries of the "pending"
// store under this prefix. Only the name, no code, so the start task (components/devices/
// register.ts) can see whether there is anything to clean up without loading the module.
export const PAIRING_PENDING_PREFIX = "pairing:"
