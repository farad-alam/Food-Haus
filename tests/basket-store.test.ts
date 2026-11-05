import { describe, expect, it } from "vitest";
import { addLine, EMPTY, lineKey, parseStored, setLineQty } from "@/lib/basket-store";

const plain = (id: string, name: string, price: number, qty: number) => ({ key: id, id, name, price, qty, optionIds: [], optionNames: [] });

describe("parseStored — storage is untrusted input", () => {
  it("returns an empty basket for null, junk and wrong shapes", () => {
    for (const raw of [null, "", "not json", "42", "null", '"str"', "[]"]) {
      expect(parseStored(raw)).toEqual(EMPTY);
    }
  });

  it("keeps valid lines and the note", () => {
    const raw = JSON.stringify({ lines: [{ id: "a", name: "A", price: 799, qty: 2 }], note: "no onions" });
    // a basket saved before options existed still loads, as a line with no options
    expect(parseStored(raw)).toEqual({ lines: [plain("a", "A", 799, 2)], note: "no onions" });
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
    expect(parseStored(raw).lines).toEqual([plain("ok", "OK", 100, 1)]);
  });

  it("truncates an over-long note to 200 characters", () => {
    expect(parseStored(JSON.stringify({ lines: [], note: "x".repeat(500) })).note).toHaveLength(200);
  });
});

describe("lines with options", () => {
  const meal = { id: "burgers-classic", name: "Classic Burger", price: 1148, optionIds: ["meal"], optionNames: ["Meal"] };
  const plainBurger = { id: "burgers-classic", name: "Classic Burger", price: 799 };

  it("the same item with and without options are separate lines; identical choices merge", () => {
    let s = addLine(EMPTY, plainBurger);
    s = addLine(s, meal);
    s = addLine(s, meal);
    expect(s.lines.map((l) => [l.key, l.qty])).toEqual([["burgers-classic", 1], ["burgers-classic|meal", 2]]);
  });
  it("option order does not change the line's identity", () => {
    expect(lineKey("x", ["b", "a"])).toBe(lineKey("x", ["a", "b"]));
    expect(lineKey("x", [])).toBe("x");
    expect(lineKey("x", ["a"])).not.toBe(lineKey("x", ["b"]));
  });
  it("quantity changes apply to one line only", () => {
    let s = addLine(addLine(EMPTY, plainBurger), meal);
    s = setLineQty(s, "burgers-classic|meal", 3);
    expect(s.lines.map((l) => l.qty)).toEqual([1, 3]);
    expect(setLineQty(s, "burgers-classic|meal", 0).lines.map((l) => l.key)).toEqual(["burgers-classic"]);
  });
  it("round-trips through storage", () => {
    const s = addLine(addLine(EMPTY, plainBurger), meal);
    expect(parseStored(JSON.stringify(s))).toEqual(s);
  });
  it("never trusts a stored key; recomputes it, and drops malformed option data", () => {
    const raw = JSON.stringify({
      lines: [
        { key: "evil", id: "a", name: "A", price: 100, qty: 1, optionIds: ["x"], optionNames: ["X"] },
        { id: "b", name: "B", price: 100, qty: 1, optionIds: "x", optionNames: [] },
        { id: "c", name: "C", price: 100, qty: 1, optionIds: ["x"], optionNames: [] }, // names/ids length mismatch
        { id: "d", name: "D", price: 100, qty: 1, optionIds: [1], optionNames: ["1"] },
        { id: "e", name: "E", price: 100, qty: 1, optionIds: Array(11).fill("x"), optionNames: Array(11).fill("x") },
        { id: "f", name: "F", price: 100, qty: 1, optionIds: [""], optionNames: ["f"] },
      ],
    });
    expect(parseStored(raw).lines).toEqual([{ key: "a|x", id: "a", name: "A", price: 100, qty: 1, optionIds: ["x"], optionNames: ["X"] }]);
  });
  it("duplicate lines (same key) in storage keep only the first", () => {
    const l = { id: "a", name: "A", price: 100, qty: 1, optionIds: ["m"], optionNames: ["M"] };
    expect(parseStored(JSON.stringify({ lines: [l, { ...l, qty: 5 }] })).lines).toHaveLength(1);
  });
});

describe("transitions", () => {
  const line = { id: "a", name: "A", price: 799 };
  it("adds, increments and caps quantity at 20", () => {
    let s = addLine(EMPTY, line);
    expect(s.lines).toEqual([plain("a", "A", 799, 1)]);
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
