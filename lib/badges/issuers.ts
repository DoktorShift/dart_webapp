// Who may award club and tournament badges is known only to the clubs and tournaments areas: they
// register a check here, once at start, from their register modules. Nothing else lives here, so
// registering costs a start page nothing of the badges' code (./awards.ts asks the checks).

export interface IssuerCheck {
  // Whether `issuer` may award badges of this club or tournament at `at` (the award's time, unix
  // seconds); undefined while unknown.
  mayIssue(scopeId: string, issuer: string, at: number): Promise<boolean | undefined>
  // false once the result or decision an award rests on was corrected or voided.
  evidenceValid?(scopeId: string, evidence: string): Promise<boolean | undefined>
}

export type IssuerScope = "club" | "tournament"

const checks = new Map<IssuerScope, IssuerCheck>()

// Returns the function that removes the check again.
export function registerIssuerCheck(scope: IssuerScope, check: IssuerCheck) {
  checks.set(scope, check)
  return () => {
    if (checks.get(scope) === check) checks.delete(scope)
  }
}

export const issuerCheck = (scope: IssuerScope): IssuerCheck | undefined => checks.get(scope)
