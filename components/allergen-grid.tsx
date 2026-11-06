import { gridCell, type AllergenEntry, type GridCell } from "@/lib/allergens";
import { ALLERGENS } from "@/lib/menu-constants";

// The "items against the 14 allergens" grid (R11.10). A cell says something only when lib/allergens.ts
// allows it: a missing item or option makes the cells "?", never "no".
const CELL: Record<GridCell, { mark: string; word: string; cls: string }> = {
  yes: { mark: "●", word: "Contains", cls: "text-brand font-bold" },
  "via-option": { mark: "◐", word: "Can be added by an option", cls: "text-brand" },
  no: { mark: "–", word: "Not in this item", cls: "text-muted" },
  unknown: { mark: "?", word: "Not confirmed yet", cls: "text-yellow-300 font-bold" },
};

export function AllergenGrid({ category, items, options }: { category: string; items: { id: string; name: string; allergens: AllergenEntry }[]; options: AllergenEntry[] }) {
  return (
    <div className="overflow-x-auto" data-testid="allergen-grid">
      <table className="min-w-full border-collapse text-center text-sm">
        <caption className="sr-only">{category}: allergens in each item</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-[9rem] bg-ink p-2 text-left font-bold">Item</th>
            {ALLERGENS.map((a) => (
              <th key={a.key} scope="col" className="p-1 align-bottom font-normal">
                <span className="block min-w-[3.5rem] text-xs leading-tight">{a.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-line">
              <th scope="row" className="sticky left-0 z-10 bg-ink p-2 text-left font-normal">{i.name}</th>
              {ALLERGENS.map((a) => {
                const c = gridCell(a.key, i.allergens, options);
                return (
                  <td key={a.key} data-cell={c} className={`p-1 ${CELL[c].cls}`}>
                    <span aria-hidden="true">{CELL[c].mark}</span>
                    <span className="sr-only">{CELL[c].word}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        ● contains · ◐ can be added by an option · – not in this item · ? not confirmed yet, please ask. Scroll sideways to see every allergen.
      </p>
    </div>
  );
}
