"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ALLERGENS, DIETARY_TAGS } from "@/lib/menu-constants";
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
        <div className="min-w-0">
          <p className="font-bold">{it.name} <span className="font-normal text-muted">· {formatPenceExact(it.price)}</span></p>
          <p className="mt-1 flex flex-wrap gap-1 text-xs">
            {!it.visible && <span className="rounded bg-yellow-400 px-2 py-0.5 font-bold text-black">HIDDEN</span>}
            {it.soldOut && <span className="rounded bg-red-500 px-2 py-0.5 font-bold text-white">SOLD OUT</span>}
            {it.allergens === null && <span className="rounded border border-yellow-400 px-2 py-0.5 text-yellow-400">Allergens missing</span>}
          </p>
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
        <div className="mt-3"><ItemEditor categories={categories} item={it} onDone={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} /></div>
      )}
    </li>
  );
}

type Draft = { name: string; description: string; price: string; categoryId: number; confirmed: boolean; allergens: string[]; tags: string[]; soldOut: boolean; visible: boolean };

function ItemEditor({ categories, item, initial, onDone, onCancel }: { categories: AdminCategory[]; item?: AdminItem; initial?: { categoryId: number }; onDone: () => void; onCancel: () => void }) {
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

      <fieldset>
        <legend className="font-bold">Allergens (the 14 the law requires)</legend>
        <div className="mt-1 space-y-1">
          <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name={`${id}-conf`} className="h-5 w-5" checked={!d.confirmed} onChange={() => set({ confirmed: false })} /> Not supplied yet (the site shows “allergen information coming soon”)</label>
          <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name={`${id}-conf`} className="h-5 w-5" checked={d.confirmed} onChange={() => set({ confirmed: true })} /> Confirmed: tick everything this item contains</label>
        </div>
        {d.confirmed && (
          <>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {ALLERGENS.map((a) => (
                <label key={a.key} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={d.allergens.includes(a.key)} onChange={() => set({ allergens: toggle(d.allergens, a.key) })} /> {a.label}</label>
              ))}
            </div>
            {d.allergens.length === 0 && <p className="mt-1 text-sm text-yellow-400">Nothing ticked means “contains none of the 14”. Only confirm that if you have checked every ingredient.</p>}
          </>
        )}
      </fieldset>

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

type OptDraft = { name: string; required: boolean; minPicks: string; maxPicks: string; options: { name: string; price: string }[] };
const toDraft = (g: AdminOptionGroup | null): OptDraft =>
  g
    ? { name: g.name, required: g.required, minPicks: String(g.minPicks), maxPicks: String(g.maxPicks), options: g.options.map((o) => ({ name: o.name, price: penceToInput(o.priceChange) })) }
    : { name: "", required: false, minPicks: "0", maxPicks: "1", options: [{ name: "", price: "0.00" }] };

function OptionsEditor({ catId, catName, group, onChanged }: { catId: number; catName: string; group: AdminOptionGroup | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<OptDraft>(() => toDraft(group));
  const [msg, setMsg] = useState<{ text: string; good?: boolean }>({ text: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    const options = d.options.map((o) => ({ name: o.name, priceChange: parsePounds(o.price) }));
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
  const setOpt = (i: number, p: Partial<{ name: string; price: string }>) => setD((x) => ({ ...x, options: x.options.map((o, n) => (n === i ? { ...o, ...p } : o)) }));

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
              <li key={i} className="flex flex-wrap items-end gap-2">
                <label className="grow text-sm text-muted">Option<input className={`${field} mt-1 block w-full`} value={o.name} maxLength={60} placeholder="Regular meal (fries + drink)" onChange={(e) => setOpt(i, { name: e.target.value })} /></label>
                <label className="w-28 text-sm text-muted">Extra (£)<input inputMode="decimal" className={`${field} mt-1 block w-full`} value={o.price} onChange={(e) => setOpt(i, { price: e.target.value })} /></label>
                <button type="button" className={btn} aria-label={`Remove option ${i + 1}`} onClick={() => setD((x) => ({ ...x, options: x.options.filter((_, n) => n !== i) }))}>Remove</button>
              </li>
            ))}
          </ul>
          <button type="button" className={btn} onClick={() => setD((x) => ({ ...x, options: [...x.options, { name: "", price: "0.00" }] }))}>Add an option</button>
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
