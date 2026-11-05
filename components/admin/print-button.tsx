"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary !min-h-[48px] print:hidden" onClick={() => window.print()}>Print receipt</button>
  );
}
