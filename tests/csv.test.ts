import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("csv cells", () => {
  it("quotes commas and quotes, and keeps plain text plain", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(15.98)).toBe("15.98");
    expect(csvCell(NaN)).toBe("");
  });
  it("flattens line breaks so one order is always one row", () => {
    expect(csvCell("line one\nline two\r\nthree")).toBe("line one line two three");
  });
  it("neutralises spreadsheet formulas (CSV injection)", () => {
    for (const evil of ["=1+1", "+44123", "-2+3", "@SUM(A1)", "\t=cmd", "=HYPERLINK(\"http://evil\",\"x\")"]) {
      expect(csvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell("=HYPERLINK(\"http://evil\",\"x\")")).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell("a=b")).toBe("a=b"); // only the START matters
    expect(csvCell(-5)).toBe("-5"); // real numbers are not text
  });
  it("builds CRLF rows with a byte-order mark and a trailing newline", () => {
    const out = toCsv(["a", "b"], [["1", "x,y"], [2, null]]);
    expect(out).toBe('﻿a,b\r\n1,"x,y"\r\n2,\r\n');
  });
});
