const LABELS: Record<string, { text: string; cls: string }> = {
  pending_payment: { text: "Awaiting payment", cls: "bg-yellow-400 text-black" },
  received: { text: "Received", cls: "bg-blue-400 text-black" },
  preparing: { text: "Preparing", cls: "bg-blue-400 text-black" },
  ready: { text: "Ready", cls: "bg-blue-400 text-black" },
  out_for_delivery: { text: "Out for delivery", cls: "bg-blue-400 text-black" },
  completed: { text: "Completed", cls: "bg-green-500 text-black" },
  rejected: { text: "Rejected", cls: "bg-red-500 text-white" },
  cancelled: { text: "Cancelled", cls: "bg-red-500 text-white" },
  refunded: { text: "Refunded", cls: "bg-red-500 text-white" },
};
export const statusText = (s: string) => LABELS[s]?.text ?? s;
export function StatusBadge({ status }: { status: string }) {
  const l = LABELS[status] ?? { text: status, cls: "bg-surface-2 text-text" };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold print:border print:border-black print:bg-transparent print:text-black ${l.cls}`}>{l.text}</span>;
}
export const paymentText = (method: string, status: string) => (method === "cash" ? "Cash" : status === "paid" ? "Paid online" : status === "refunded" ? "Refunded (card)" : status === "failed" ? "Card payment failed" : "Card, unpaid");
