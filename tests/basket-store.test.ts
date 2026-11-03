import { describe, expect, it } from "vitest";
import { addLine, EMPTY, parseStored, setLineQty } from "@/lib/basket-store";

describe("parseStored — storage is untrusted input", () => {
  it("returns an empty basket for null, junk and wrong shapes", () => {
    for (const raw of [null, "", "not json", "42", "null", '"str"', "[]"]) {
      expect(parseStored(raw)).toEqual(EMPTY);
    }
  });

  it("keeps valid lines and the note", () => {
    const raw = JSON.stringify({ lines: [{ id: "a", name: "A", price: 799, qty: 2 }], note: "no onions" });
    expect(parseStored(raw)).toEqual({ lines: [{ id: "a", name: "A", price: 799, qty: 2 }], note: "no onions" });
  });

  it("drops invalid, tampered and duplicate lines", () => {
    const raw = JSON.stringify({
      lines: [
        { id: "ok", name: "OK", price: 100, qty: 1 },
        { id: "neg", name: "x", price: -5, qty: 1 },
        { id: "frac", name: "x", price: 1.5, qty: 1 },
        { id: "zero", name: "x", price: 100, qty: 0 },
        { id: "huge", name: "x", price: 100, qty: 999 },
        { id: "ok", name: "dup", price: 100, qty: 3 },
        { id: 7, name: "x", price: 100, qty: 1 },
        null,
      ],
    });
    expect(parseStored(raw).lines).toEqual([{ id: "ok", name: "OK", price: 100, qty: 1 }]);
  });

  it("truncates an over-long note to 200 characters", () => {
    expect(parseStored(JSON.stringify({ lines: [], note: "x".repeat(500) })).note).toHaveLength(200);
  });
});

describe("transitions", () => {
  const line = { id: "a", name: "A", price: 799 };
  it("adds, increments and caps quantity at 20", () => {
    let s = addLine(EMPTY, line);
    expect(s.lines).toEqual([{ ...line, qty: 1 }]);
    for (let i = 0; i < 30; i++) s = addLine(s, line);
    expect(s.lines[0].qty).toBe(20);
  });
  it("setLineQty removes at zero, floors fractions and caps", () => {
    const s = addLine(EMPTY, line);
    expect(setLineQty(s, "a", 0).lines).toEqual([]);
    expect(setLineQty(s, "a", 3.9).lines[0].qty).toBe(3);
    expect(setLineQty(s, "a", 99).lines[0].qty).toBe(20);
  });
  it("does not mutate the previous state", () => {
    const s = addLine(EMPTY, line);
    const before = JSON.stringify(s);
    addLine(s, line);
    setLineQty(s, "a", 5);
    expect(JSON.stringify(s)).toBe(before);
  });
});
