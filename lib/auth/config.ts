// Admin sign-in settings.
//
// ADMIN_TWO_STEP decides whether the second login step (a 6-digit authenticator code or a recovery code) is
// ever asked for. It is OFF by default: with it off, every role signs in with email and password only, even
// an owner who already enrolled an authenticator. Set it to "on" (also accepts true, 1, yes) to switch the
// code step back on for owners and managers; all the code, enrolment and recovery-code machinery stays in
// place for that. This is an owner decision that changes R9.2 (see docs/requirements.md).
export function twoStepEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(on|true|1|yes)$/i.test((env.ADMIN_TWO_STEP ?? "").trim());
}
