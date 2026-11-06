import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { loadContact } from "@/lib/contact-public";
import { OrderReceipt } from "@/components/admin/order-receipt";
import { loadOrderDetail } from "@/lib/admin/history";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { getDb } from "@/lib/db/client";

export const metadata: Metadata = { title: "Order" };

export default function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-muted" role="status">Loading…</p>}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: Promise<{ number: string }> }) {
  await requireAdminPage("orders.history"); // checked on this page itself, not only in the layout
  const { number } = await params;
  if (!/^\d{1,9}$/.test(number)) notFound();
  const detail = await loadOrderDetail(getDb(), Number(number));
  if (!detail) notFound();
  const { contact } = await loadContact(getDb());
  return <OrderReceipt o={detail} contact={contact} />;
}
