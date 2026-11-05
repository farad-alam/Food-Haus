import { renderSVG } from "uqr";

/** A QR code as a data: URI for an <img> (an image context cannot run script, unlike inline SVG). */
export function qrDataUri(text: string): string {
  return `data:image/svg+xml;base64,${btoa(renderSVG(text, { border: 2 }))}`;
}

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP": easier to type into an authenticator app. */
export const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;
