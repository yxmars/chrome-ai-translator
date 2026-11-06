/** Canonicalize prose spacing without changing paragraph/newline boundaries. */
export function normalizeText(text: string) {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t \u00a0]+/g, " ")
    .trim();
}
