/**
 * Shared helpers for the member deliverable upload controls (the execution
 * panel's delivery form and the workflows page's deliverables section).
 */

/**
 * Read a picked file as raw base64. readAsDataURL yields
 * "data:<mime>;base64,<b64>"; the prefix is stripped so the backend gets raw
 * base64 (binary-safe, any format).
 */
export function readFileAsBase64(file: File): Promise<{ name: string; content: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = String(reader.result ?? "");
      const comma = r.indexOf(",");
      resolve({ name: file.name, content: comma >= 0 ? r.slice(comma + 1) : r });
    };
    reader.readAsDataURL(file);
  });
}

/** Split a one-link-per-line textarea value into trimmed, non-empty links. */
export function parseLinkLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Every parsed link must be an http(s) URL before submitting. */
export function hasInvalidLinkLine(links: string[]): boolean {
  return links.some((line) => !/^https?:\/\//i.test(line));
}
