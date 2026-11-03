// All money is stored and calculated as whole pence (R6, section 12).

export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return pence % 100 === 0 ? `£${pounds.toFixed(0)}` : `£${pounds.toFixed(2)}`;
}

/** Always two decimals — used for totals and receipts. */
export function formatPenceExact(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
