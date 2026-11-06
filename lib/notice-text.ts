// The site-wide notice bar text (R9.9): plain text, one short line, never HTML.
export const MAX_NOTICE = 200;

export const cleanNotice = (raw: string | null | undefined): string | null => {
  const t = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTICE);
  return t || null;
};
