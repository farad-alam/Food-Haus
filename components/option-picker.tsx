"use client";

import { useId, useRef, useState } from "react";
import { useBasket } from "@/components/basket";
import { formatPenceExact } from "@/lib/money";
import { inGroupOrder, isSingleChoice, isValidSelection, optionNames, ruleText, toggleOption, unitPrice, type PickerGroup } from "@/lib/option-select";

// "Make it a Meal" and extras (R6.2). A native <dialog>: the browser traps
// focus, closes on Escape and marks the page behind it inert. Choices follow
// the same rules the server enforces (lib/option-select.ts); the price shown
// is a preview, the server prices the order again.

export function AddWithOptions({ id, name, price, group }: { id: string; name: string; price: number; group: PickerGroup }) {
  const { add } = useBasket();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const uid = useId();
  const single = isSingleChoice(group);
  const valid = isValidSelection(group, selected);
  const total = unitPrice(price, group, selected);

  function open() {
    setSelected([]); // always start from "nothing chosen"
    dialog.current?.showModal();
  }
  function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const ids = inGroupOrder(group, selected);
    add({ id, name, price: total, optionIds: ids, optionNames: optionNames(group, ids) });
    dialog.current?.close();
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={open} aria-haspopup="dialog" aria-label={`Add ${name} to basket`}>
        Add
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${uid}-t`}
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()} // click on the dimmed backdrop
        className="m-0 mt-auto w-full max-w-none rounded-t-2xl border-t border-line bg-surface p-0 text-text backdrop:bg-black/70 sm:m-auto sm:max-w-md sm:rounded-2xl sm:border"
      >
        <form onSubmit={confirm} className="p-4">
          <h2 id={`${uid}-t`} className="font-display text-3xl">{name}</h2>
          <fieldset className="mt-3">
            <legend className="font-bold">{group.name}</legend>
            <p className="text-sm text-muted">{ruleText(group)}</p>
            <div className="mt-2 space-y-2">
              {single && !group.required && (
                <label className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border px-3 ${selected.length === 0 ? "border-brand" : "border-line"}`}>
                  <input type="radio" name={`${uid}-opt`} className="h-5 w-5" checked={selected.length === 0} onChange={() => setSelected([])} />
                  <span className="grow">No thanks</span>
                </label>
              )}
              {group.options.map((o) => {
                const on = selected.includes(o.id);
                const atMax = !single && !on && selected.length >= group.maxPicks;
                return (
                  <label key={o.id} className={`flex min-h-[52px] items-center gap-3 rounded-lg border px-3 ${on ? "border-brand" : "border-line"} ${atMax ? "opacity-50" : "cursor-pointer"}`}>
                    <input
                      type={single ? "radio" : "checkbox"}
                      name={`${uid}-opt`}
                      className="h-5 w-5"
                      checked={on}
                      disabled={atMax}
                      onChange={() => setSelected(toggleOption(group, selected, o.id))}
                    />
                    <span className="grow">{o.name}</span>
                    <span className="whitespace-nowrap text-muted">{o.priceChange > 0 ? `+${formatPenceExact(o.priceChange)}` : "Free"}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="mt-3 text-lg font-bold" aria-live="polite">Price: {formatPenceExact(total)}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button type="button" className="btn btn-ghost !min-h-[52px]" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className="btn btn-primary !min-h-[52px]" disabled={!valid}>Add to basket</button>
          </div>
          {!valid && <p className="mt-2 text-sm text-muted" role="status">{ruleText(group)} to continue.</p>}
        </form>
      </dialog>
    </>
  );
}
