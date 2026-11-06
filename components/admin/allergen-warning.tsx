import Link from "next/link";
import type { Readiness } from "@/lib/allergens";

/** Staff-facing warning shown on every admin page (owner and manager) while allergen data is incomplete. */
export function AllergenWarning({ readiness }: { readiness: Readiness }) {
  if (readiness.ready) return null;
  const items = readiness.itemsMissing.length;
  const opts = readiness.optionsMissing.length;
  return (
    <div role="alert" data-testid="allergen-warning" className="border-b border-yellow-400 bg-yellow-400/10 px-4 py-3 text-yellow-200 print:hidden">
      <div className="mx-auto max-w-6xl">
        <p className="font-bold">
          Allergen information is NOT complete{readiness.itemsTotal === 0 ? " (there are no menu items)" : `: ${items} of ${readiness.itemsTotal} item${readiness.itemsTotal === 1 ? "" : "s"}${opts ? ` and ${opts} option${opts === 1 ? "" : "s"}` : ""} still ${items + opts === 1 ? "has" : "have"} none entered`}.
        </p>
        <p className="text-sm">
          Customers are told to ask before ordering for those, and the allergen page stays hidden from search engines. Complete it before the shop goes live. <Link href="/admin/menu" className="underline">Open the menu manager</Link>
        </p>
      </div>
    </div>
  );
}
