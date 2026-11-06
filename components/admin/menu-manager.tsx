"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ALLERGENS, DIETARY_TAGS } from "@/lib/menu-constants";
import { photoSrcSet, photoUrl } from "@/lib/photos/keys";
import { MAX_ALT_LENGTH, MAX_UPLOAD_BYTES, MIN_SOURCE } from "@/lib/photos/types";
import { formatPenceExact, parsePounds, penceToInput } from "@/lib/money";
import type { AdminCategory, AdminItem, AdminOptionGroup, MenuAdminView } from "@/lib/admin/menu";
import { api, failMessage, field, Msg } from "./ui";

// Menu manager (R9.7). Prices are typed in pounds and sent as whole pence; the
// server re-validates everything. Changes reach the public site on its next
// page view (the server refreshes the menu cache after every save).

const btn = "btn btn-ghost !min-h-[44px] !px-3 text-sm";

export function MenuManager() {
  const [view, setView] = useState<MenuAdminView | null>(null);
  const [error, setError] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);

  const reload = useCallback(async () => {
    const o = await api("GET", "/api/admin/menu");
    if (o.ok) setView(o.data as unknown as MenuAdminView);
    else setError(failMessage(o));
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const o = await api("GET", "/api/admin/menu");
      if (cancelled) return;
      if (o.ok) setView(o.data as unknown as MenuAdminView);
      else setError(failMessage(o));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p role="alert" className="p-4 text-red-400">{error} <Link href="/admin/login" className="underline">Sign in</Link></p>;
  if (!view) return <p className="p-4 text-muted" role="status">Loading menu…</p>;

  const missing = view.items.filter((i) => i.visible && i.allergens === null).length;
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 pb-20 pt-6">
      <h1 className="font-display text-4xl">Menu</h1>
      <p className="text-sm text-muted">Changes appear on the website the next time someone opens the page.</p>

      {missing > 0 ? (
        <div role="status" className="rounded-lg border-2 border-yellow-400 p-3">
          <p className="font-bold text-yellow-400">{missing} item{missing === 1 ? " has" : "s have"} no allergen information yet.</p>
          <p className="text-sm text-muted">Allergen details for every item must be entered before the site goes live.</p>
          <label className="mt-2 flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Show only items missing allergen information</label>
        </div>
      ) : (
        <p role="status" className="rounded-lg border border-green-500 p-3 text-green-400">Every visible item has allergen information.</p>
      )}

      {view.categories.map((c, n) => (
        <CategoryBlock key={c.id} cat={c} index={n} view={view} onlyMissing={onlyMissing} reload={reload} />
      ))}
      <AddCategory onAdded={reload} />
    </div>
  );
}

function AddCategory({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  async function add() {
    setMsg("");
    const o = await api("POST", "/api/admin/menu/categories", { name });
    if (o.ok) {
      setName("");
      onAdded();
    } else setMsg(failMessage(o));
  }
  return (
    <div className="rounded-lg border border-dashed border-line p-3">
      <h2 className="font-bold">Add a category</h2>
      <div className="mt-2 flex gap-2">
        <input aria-label="New category name" className={`${field} grow`} value={name} maxLength={60} placeholder="Desserts" onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn btn-primary !min-h-[48px]" disabled={!name.trim()} onClick={add}>Add</button>
      </div>
      <Msg text={msg} />
    </div>
  );
}

// ---- one category -----------------------------------------------------------------------

function CategoryBlock({ cat, index, view, onlyMissing, reload }: { cat: AdminCategory; index: number; view: MenuAdminView; onlyMissing: boolean; reload: () => void }) {
  const items = view.items.filter((i) => i.categoryId === cat.id);
  const shown = onlyMissing ? items.filter((i) => i.allergens === null) : items;
  const group = view.optionGroups.find((g) => g.categoryId === cat.id) ?? null;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(cat.name);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");

  async function move(dir: -1 | 1) {
    const ids = view.categories.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    const o = await api("POST", "/api/admin/menu/categories/reorder", { ids });
    if (o.ok) reload();
    else setMsg(failMessage(o));
  }
  async function save(patch: { name?: string; visible?: boolean }) {
    setMsg("");
    const o = await api("PUT", `/api/admin/menu/categories/${cat.id}`, { name: patch.name ?? cat.name, visible: patch.visible ?? cat.visible });
    if (o.ok) {
      setRenaming(false);
      reload();
    } else setMsg(failMessage(o));
  }
  async function remove() {
    if (!window.confirm(`Delete the “${cat.name}” category? This cannot be undone.`)) return;
    const o = await api("DELETE", `/api/admin/menu/categories/${cat.id}`);
    if (o.ok) reload();
    else setMsg(failMessage(o));
  }

  return (
    <section aria-labelledby={`cat-${cat.id}`} className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <div className="flex grow gap-2">
            <input aria-label="Category name" className={`${field} grow`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn btn-primary !min-h-[48px]" onClick={() => save({ name })}>Save</button>
            <button type="button" className={btn} onClick={() => { setRenaming(false); setName(cat.name); }}>Cancel</button>
          </div>
        ) : (
          <h2 id={`cat-${cat.id}`} className="font-display text-3xl">{cat.name}{!cat.visible && <span className="ml-2 align-middle text-base text-yellow-400">Hidden</span>}</h2>
        )}
        {!renaming && (
          <div className="flex flex-wrap gap-1">
            <button type="button" className={btn} aria-label={`Move ${cat.name} up`} onClick={() => move(-1)} disabled={index === 0}>▲</button>
            <button type="button" className={btn} aria-label={`Move ${cat.name} down`} onClick={() => move(1)} disabled={index === view.categories.length - 1}>▼</button>
            <button type="button" className={btn} onClick={() => setRenaming(true)}>Rename</button>
            <button type="button" className={btn} onClick={() => save({ visible: !cat.visible })}>{cat.visible ? "Hide" : "Show"}</button>
            <button type="button" className={btn} onClick={remove}>Delete</button>
          </div>
        )}
      </div>
      <Msg text={msg} />

      <ul className="mt-3 divide-y divide-line border-y border-line">
        {shown.map((it) => (
          <ItemRow key={it.id} it={it} items={items} categories={view.categories} reload={reload} />
        ))}
        {shown.length === 0 && <li className="py-3 text-muted">{onlyMissing ? "Nothing missing here." : "No items yet."}</li>}
      </ul>

      {adding ? (
        <div className="mt-3"><ItemEditor categories={view.categories} initial={{ categoryId: cat.id }} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} /></div>
      ) : (
        <button type="button" className="btn btn-primary mt-3 !min-h-[48px]" onClick={() => setAdding(true)}>Add an item to {cat.name}</button>
      )}

      <OptionsEditor key={`opt-${cat.id}`} catId={cat.id} catName={cat.name} group={group} onChanged={reload} />
    </section>
  );
}

// ---- one item ----------------------------------------------------------------------------------

function ItemRow({ it, items, categories, reload }: { it: AdminItem; items: AdminItem[]; categories: AdminCategory[]; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const idx = items.findIndex((x) => x.id === it.id);

  async function flag(p: { soldOut?: boolean; visible?: boolean }) {
    setMsg("");
    const o = await api("PATCH", `/api/admin/menu/items/${it.id}`, p);
    if (o.ok) reload();
    else setMsg(failMessage(o));
  }
  async function move(dir: -1 | 1) {
    const ids = items.map((x) => x.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    const o = await api("POST", "/api/admin/menu/items/reorder", { categoryId: it.categoryId, ids });
    if (o.ok) reload();
    else setMsg(failMessage(o));
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          {it.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- served from our own /media route, already resized
            <img src={photoUrl(it.photo, 400)} alt="" width={64} height={48} className="h-12 w-16 shrink-0 rounded object-cover" />
          )}
          <div className="min-w-0">
          <p className="font-bold">{it.name} <span className="font-normal text-muted">· {formatPenceExact(it.price)}</span></p>
          <p className="mt-1 flex flex-wrap gap-1 text-xs">
            {!it.visible && <span className="rounded bg-yellow-400 px-2 py-0.5 font-bold text-black">HIDDEN</span>}
            {it.soldOut && <span className="rounded bg-red-500 px-2 py-0.5 font-bold text-white">SOLD OUT</span>}
            {it.allergens === null && <span className="rounded border border-yellow-400 px-2 py-0.5 text-yellow-400">Allergens missing</span>}
          </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={btn} aria-label={`Move ${it.name} up`} disabled={idx === 0} onClick={() => move(-1)}>▲</button>
          <button type="button" className={btn} aria-label={`Move ${it.name} down`} disabled={idx === items.length - 1} onClick={() => move(1)}>▼</button>
          <button type="button" className={btn} aria-pressed={it.soldOut} onClick={() => flag({ soldOut: !it.soldOut })}>{it.soldOut ? "Back in stock" : "Sold out"}</button>
          <button type="button" className={btn} aria-pressed={!it.visible} onClick={() => flag({ visible: !it.visible })}>{it.visible ? "Hide" : "Show"}</button>
          <button type="button" className={btn} aria-expanded={editing} onClick={() => setEditing((e) => !e)}>{editing ? "Close" : "Edit"}</button>
        </div>
      </div>
      <Msg text={msg} />
      {editing && (
        <div className="mt-3"><ItemEditor categories={categories} item={it} onPhotoChanged={reload} onDone={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} /></div>
      )}
    </li>
  );
}

type Draft = { name: string; description: string; price: string; categoryId: number; confirmed: boolean; allergens: string[]; tags: string[]; soldOut: boolean; visible: boolean };

function ItemEditor({ categories, item, initial, onDone, onCancel, onPhotoChanged }: { categories: AdminCategory[]; item?: AdminItem; initial?: { categoryId: number }; onDone: () => void; onCancel: () => void; onPhotoChanged?: () => void }) {
  const [d, setD] = useState<Draft>({
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item ? penceToInput(item.price) : "",
    categoryId: item?.categoryId ?? initial!.categoryId,
    confirmed: item ? item.allergens !== null : false,
    allergens: item?.allergens ?? [],
    tags: item?.dietaryTags ?? [],
    soldOut: item?.soldOut ?? false,
    visible: item?.visible ?? true,
  });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const toggle = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

  async function save() {
    const price = parsePounds(d.price);
    if (price === null || price < 1) return setMsg("Enter the price in pounds, like 7.99.");
    // A typo like 79.9 for 7.99 is the costliest mistake here: ask when the price jumps or collapses.
    if (item && (price > item.price * 3 || price * 3 < item.price) && !window.confirm(`The price changes from ${formatPenceExact(item.price)} to ${formatPenceExact(price)}. Is that right?`)) return;
    const body = {
      name: d.name,
      description: d.description,
      price,
      categoryId: d.categoryId,
      allergens: d.confirmed ? ALLERGENS.map((a) => a.key).filter((k) => d.allergens.includes(k)) : null,
      dietaryTags: DIETARY_TAGS.map((t) => t.key).filter((k) => d.tags.includes(k)),
      soldOut: d.soldOut,
      visible: d.visible,
    };
    setBusy(true);
    setMsg("");
    const o = item ? await api("PUT", `/api/admin/menu/items/${item.id}`, body) : await api("POST", "/api/admin/menu/items", body);
    setBusy(false);
    if (o.ok) onDone();
    else setMsg(failMessage(o));
  }
  async function remove() {
    if (!item || !window.confirm(`Delete “${item.name}”? Past orders keep their own record. This cannot be undone. (To just take it off the menu, use Hide.)`)) return;
    const o = await api("DELETE", `/api/admin/menu/items/${item.id}`);
    if (o.ok) onDone();
    else setMsg(failMessage(o));
  }

  const id = `item-${item?.id ?? "new"}-${d.categoryId}`;
  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-3">
      <h3 className="font-bold">{item ? `Edit ${item.name}` : "New item"}</h3>
      <label className="block font-bold">Name<input className={`${field} mt-1 block w-full font-normal`} value={d.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="block font-bold">Description<textarea className={`${field} mt-1 block w-full font-normal`} rows={3} value={d.description} maxLength={600} onChange={(e) => set({ description: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block font-bold">Price (£)<input inputMode="decimal" className={`${field} mt-1 block w-full font-normal`} value={d.price} placeholder="7.99" onChange={(e) => set({ price: e.target.value })} /></label>
        <label className="block font-bold">Category
          <select className={`${field} mt-1 block w-full font-normal`} value={d.categoryId} onChange={(e) => set({ categoryId: Number(e.target.value) })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      {item ? <PhotoFields item={item} onChanged={() => onPhotoChanged?.()} /> : <p className="text-sm text-muted">Save the item first, then you can add a photo.</p>}

      <AllergenFields id={id} confirmed={d.confirmed} selected={d.allergens} subject="this item" onChange={(p) => set(p)} />

      <fieldset>
        <legend className="font-bold">Tags</legend>
        <div className="mt-1 flex flex-wrap gap-x-4">
          {DIETARY_TAGS.map((t) => (
            <label key={t.key} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={d.tags.includes(t.key)} onChange={() => set({ tags: toggle(d.tags, t.key) })} /> {t.label}</label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-x-6">
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={d.visible} onChange={(e) => set({ visible: e.target.checked })} /> Shown on the menu</label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={d.soldOut} onChange={(e) => set({ soldOut: e.target.checked })} /> Sold out</label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary !min-h-[48px]" disabled={busy} onClick={save}>{busy ? "Saving…" : item ? "Save changes" : "Add item"}</button>
        <button type="button" className={btn} onClick={onCancel}>Cancel</button>
        {item && <button type="button" className={btn} onClick={remove}>Delete</button>}
      </div>
      <Msg text={msg} />
    </div>
  );
}

// ---- options ("Make it a Meal") ---------------------------------------------------------------------

type OptRow = { name: string; price: string; confirmed: boolean; allergens: string[] };
type OptDraft = { name: string; required: boolean; minPicks: string; maxPicks: string; options: OptRow[] };
const newOpt = (): OptRow => ({ name: "", price: "0.00", confirmed: false, allergens: [] }); // allergens are NEVER pre-confirmed
const toDraft = (g: AdminOptionGroup | null): OptDraft =>
  g
    ? { name: g.name, required: g.required, minPicks: String(g.minPicks), maxPicks: String(g.maxPicks), options: g.options.map((o) => ({ name: o.name, price: penceToInput(o.priceChange), confirmed: o.allergens !== null, allergens: o.allergens ?? [] })) }
    : { name: "", required: false, minPicks: "0", maxPicks: "1", options: [newOpt()] };

function OptionsEditor({ catId, catName, group, onChanged }: { catId: number; catName: string; group: AdminOptionGroup | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<OptDraft>(() => toDraft(group));
  const [msg, setMsg] = useState<{ text: string; good?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    const options = d.options.map((o) => ({ name: o.name, priceChange: parsePounds(o.price), allergens: o.confirmed ? ALLERGENS.map((a) => a.key).filter((k) => o.allergens.includes(k)) : null }));
    if (options.some((o) => o.priceChange === null)) return setMsg({ text: "Enter each extra price in pounds, like 3.49 (or 0 for no charge)." });
    const min = Number(d.minPicks);
    const max = Number(d.maxPicks);
    if (!Number.isInteger(min) || !Number.isInteger(max)) return setMsg({ text: "Use whole numbers for the minimum and maximum." });
    setBusy(true);
    const o = await api("PUT", `/api/admin/menu/options/${catId}`, { name: d.name, required: d.required, minPicks: min, maxPicks: max, options });
    setBusy(false);
    if (o.ok) {
      setMsg({ text: "Options saved.", good: true });
      onChanged();
    } else setMsg({ text: failMessage(o) });
  }
  async function remove() {
    if (!window.confirm(`Remove the options from ${catName}?`)) return;
    const o = await api("DELETE", `/api/admin/menu/options/${catId}`);
    if (o.ok) {
      setD(toDraft(null));
      setOpen(false);
      onChanged();
    } else setMsg({ text: failMessage(o) });
  }
  const setOpt = (i: number, p: Partial<OptRow>) => setD((x) => ({ ...x, options: x.options.map((o, n) => (n === i ? { ...o, ...p } : o)) }));

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button type="button" className={btn} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {group ? `Options: ${group.name} (${group.options.length})` : "Add options (like “Make it a Meal”)"}
      </button>
      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-line bg-surface p-3">
          <p className="text-sm text-muted">Options apply to every item in {catName}. A category has one option group. Customers choose between the minimum and maximum number of options.</p>
          <label className="block font-bold">Group name<input className={`${field} mt-1 block w-full font-normal`} value={d.name} maxLength={60} placeholder="Make it a Meal" onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
          <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={d.required} onChange={(e) => setD({ ...d, required: e.target.checked })} /> Customers must choose one</label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block font-bold">Fewest to pick<input inputMode="numeric" className={`${field} mt-1 block w-full font-normal`} value={d.minPicks} onChange={(e) => setD({ ...d, minPicks: e.target.value })} /></label>
            <label className="block font-bold">Most to pick<input inputMode="numeric" className={`${field} mt-1 block w-full font-normal`} value={d.maxPicks} onChange={(e) => setD({ ...d, maxPicks: e.target.value })} /></label>
          </div>
          <ul className="space-y-2">
            {d.options.map((o, i) => (
              <li key={i} className="space-y-2 rounded-lg border border-line p-2">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grow text-sm text-muted">Option<input className={`${field} mt-1 block w-full`} value={o.name} maxLength={60} placeholder="Regular meal (fries + drink)" onChange={(e) => setOpt(i, { name: e.target.value })} /></label>
                  <label className="w-28 text-sm text-muted">Extra (£)<input inputMode="decimal" className={`${field} mt-1 block w-full`} value={o.price} onChange={(e) => setOpt(i, { price: e.target.value })} /></label>
                  <button type="button" className={btn} aria-label={`Remove option ${i + 1}`} onClick={() => setD((x) => ({ ...x, options: x.options.filter((_, n) => n !== i) }))}>Remove</button>
                </div>
                <details open>
                  <summary className={`cursor-pointer text-sm font-bold ${o.confirmed ? "" : "text-yellow-400"}`}>
                    Allergens: {o.confirmed ? (o.allergens.length ? ALLERGENS.filter((a) => o.allergens.includes(a.key)).map((a) => a.label).join(", ") : "none of the 14 (confirmed)") : "NOT ENTERED YET"}
                  </summary>
                  <AllergenFields id={`opt${i}`} confirmed={o.confirmed} selected={o.allergens} subject="this option" onChange={(p) => setOpt(i, p)} />
                </details>
              </li>
            ))}
          </ul>
          <button type="button" className={btn} onClick={() => setD((x) => ({ ...x, options: [...x.options, newOpt()] }))}>Add an option</button>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary !min-h-[48px]" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save options"}</button>
            {group && <button type="button" className={btn} onClick={remove}>Remove options</button>}
          </div>
          <Msg text={msg.text} good={msg.good} />
        </div>
      )}
    </div>
  );
}

/** The explicit "not entered / confirmed" choice plus the 14 tick boxes, for an item or an option. Nothing is ever pre-ticked or pre-confirmed. */
const toggleKey = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
function AllergenFields({ id, confirmed, selected, subject, onChange }: { id: string; confirmed: boolean; selected: string[]; subject: string; onChange: (p: { confirmed?: boolean; allergens?: string[] }) => void }) {
  return (
    <fieldset className="mt-1">
      <legend className="font-bold">Allergens (the 14 the law requires)</legend>
      <div className="mt-1 space-y-1">
        <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name={`${id}-conf`} className="h-5 w-5" checked={!confirmed} onChange={() => onChange({ confirmed: false })} /> Not entered yet (the site says “please ask”, and shows no allergen claim)</label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name={`${id}-conf`} className="h-5 w-5" checked={confirmed} onChange={() => onChange({ confirmed: true })} /> I have checked: tick everything {subject} contains</label>
      </div>
      {confirmed && (
        <>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {ALLERGENS.map((a) => (
              <label key={a.key} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={selected.includes(a.key)} onChange={() => onChange({ allergens: toggleKey(selected, a.key) })} /> {a.label}</label>
            ))}
          </div>
          {selected.length === 0 && <p className="mt-1 text-sm text-yellow-400">Nothing ticked means “contains none of the 14”, and the website will say so. Only confirm that if you have checked every ingredient{subject === "this option" ? " in this option" : ""}.</p>}
        </>
      )}
    </fieldset>
  );
}

/** Upload, describe or remove one item's photo. The server resizes and re-encodes it; nothing here is trusted. */
function PhotoFields({ item, onChanged }: { item: AdminItem; onChanged: () => void }) {
  const [alt, setAlt] = useState(item.photoAlt ?? "");
  const [msg, setMsg] = useState<{ text: string; good?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const url = `/api/admin/menu/items/${item.id}/photo`;

  async function upload(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) return setMsg({ text: `That file is too big. Photos can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` });
    setBusy(true);
    setMsg({ text: "Uploading…", good: true });
    const form = new FormData();
    form.append("file", file);
    form.append("alt", alt);
    try {
      const res = await fetch(url, { method: "POST", body: form });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok !== false) {
        setMsg({ text: "Photo saved.", good: true });
        onChanged();
      } else setMsg({ text: res.status === 401 ? "You have been signed out. Sign in again." : out.message || "That did not work. Please try again." });
    } catch {
      setMsg({ text: "No connection. The photo was not saved." });
    }
    setBusy(false);
  }
  async function saveAlt() {
    setBusy(true);
    const o = await api("PUT", url, { alt: alt.trim() || null });
    setBusy(false);
    if (o.ok) {
      setMsg({ text: "Description saved.", good: true });
      onChanged();
    } else setMsg({ text: failMessage(o) });
  }
  async function remove() {
    if (!window.confirm("Remove this photo?")) return;
    setBusy(true);
    const o = await api("DELETE", url);
    setBusy(false);
    if (o.ok) {
      setAlt("");
      setMsg({ text: "Photo removed.", good: true });
      onChanged();
    } else setMsg({ text: failMessage(o) });
  }
  return (
    <fieldset>
      <legend className="font-bold">Photo</legend>
      <div className="mt-1 space-y-2">
        {item.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- served from our own /media route, already resized
          <img src={photoUrl(item.photo, 800)} srcSet={photoSrcSet(item.photo)} sizes="320px" alt={item.photoAlt || item.name} width={320} height={240} className="aspect-[4/3] w-80 max-w-full rounded-lg object-cover" />
        ) : (
          <p className="text-sm text-muted">No photo yet. The menu shows this item without one.</p>
        )}
        <label className="block text-sm text-muted">
          {item.photo ? "Replace the photo" : "Add a photo"} (JPEG, PNG or WebP, at least {MIN_SOURCE.width} x {MIN_SOURCE.height} pixels)
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="mt-1 block min-h-[48px] w-full" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        </label>
        <label className="block text-sm text-muted">
          Describe the photo for people who cannot see it (leave blank to use the item name)
          <input className={`${field} mt-1 block w-full`} value={alt} maxLength={MAX_ALT_LENGTH} placeholder="Double smash burger with melted cheese on a toasted bun" onChange={(e) => setAlt(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          {item.photo && <button type="button" className={btn} disabled={busy} onClick={saveAlt}>Save description</button>}
          {item.photo && <button type="button" className={btn} disabled={busy} onClick={remove}>Remove photo</button>}
        </div>
        <Msg text={msg.text} good={msg.good} />
      </div>
    </fieldset>
  );
}
