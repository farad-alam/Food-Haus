// All money is stored and calculated as whole pence (R6, section 12).

export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return pence % 100 === 0 ? `£${pounds.toFixed(0)}` : `£${pounds.toFixed(2)}`;
}

/** Always two decimals — used for totals and receipts. */
export function formatPenceExact(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Parses a pounds amount typed by a person ("2.5", "£2.50", "10") into whole
 * pence. Strict: at most 2 decimals, digits only, no negatives; anything else is
 * null so a typo is shown to the user instead of silently becoming a price.
 */
export function parsePounds(input: string): number | null {
  const m = /^£?\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

/** Pence -> "2.50" for an input field (no currency symbol). */
export function penceToInput(pence: number): string {
  return (pence / 100).toFixed(2);
}
