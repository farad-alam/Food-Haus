import { getNotice } from "@/lib/notice";

/** R9.9 site-wide notice. Rendered into the page HTML (not added later), so nothing above existing content moves (R10.8). */
export async function NoticeBar() {
  let text: string | null = null;
  try {
    text = await getNotice();
  } catch {
    return null; // a notice is never worth an error page
  }
  if (!text) return null;
  return (
    <div role="status" data-testid="notice-bar" className="bg-brand px-4 py-2 text-center text-sm font-bold text-black">
      {text}
    </div>
  );
}
