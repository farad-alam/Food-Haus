// CSV for spreadsheet apps (R9.11 export). Two things matter:
//  1. Correct quoting (commas, quotes and line breaks inside a cell).
//  2. FORMULA INJECTION: a cell that starts with = + - @ (or a tab/CR) is run as
//     a formula by Excel/Sheets, so a customer who typed `=HYPERLINK(...)` as
//     their name could attack the person opening the export. Such text cells are
//     prefixed with an apostrophe, which spreadsheets show as plain text.

export type CsvValue = string | number | null | undefined;

const DANGEROUS_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v.replace(/\r\n|\r|\n/g, " ").replace(/\u0000/g, ""); // one row per order, always
  if (DANGEROUS_START.test(s)) s = `'${s}`;
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CRLF-separated, with a UTF-8 byte-order mark so Excel reads £ and accents correctly. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
