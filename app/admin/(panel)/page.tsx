import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderBoard } from "@/components/admin/order-board";
import { requireAdminPage } from "@/lib/admin/page-auth";

export const metadata: Metadata = { title: "Order board" };

export default function BoardPage() {
  return (
    <Suspense fallback={<p className="p-4 text-muted" role="status">Loading…</p>}>
      <Board />
    </Suspense>
  );
}

async function Board() {
  await requireAdminPage("orders.view"); // authorised here as well as in the layout and the API
  return <OrderBoard />;
}
