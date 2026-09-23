import "server-only";
import sanitizeHtml from "sanitize-html";

// Content Body (PRD 8.12) is deliberately basic formatting only — bold, italic, headings,
// bullet + numbered lists. No links, images, tables, colours, styles, or classes. The editor
// is WYSIWYG (contentEditable), so the submitted HTML is untrusted and MUST be sanitized
// server-side against this allowlist before storage — never trust the client markup.
export const MAX_CONTENT_BODY_CHARS = 50_000;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "h2", "h3", "ul", "ol", "li"],
  allowedAttributes: {}, // strip every attribute (no style/class/onclick/href/src/etc.)
  // Normalize the varied markup contentEditable emits down to the allowed set. Anything not
  // listed is dropped while its text is kept, so pasted rich content degrades to plain text.
  transformTags: {
    div: "p",
    b: "strong",
    i: "em",
    h1: "h2",
    h4: "h3",
    h5: "h3",
    h6: "h3",
  },
  disallowedTagsMode: "discard",
};

/** Sanitize submitted Content Body HTML to the allowlist above. */
export function sanitizeContentBody(input: string): string {
  return sanitizeHtml(input, OPTIONS).trim();
}

/** True when the (sanitized) HTML carries no actual text — e.g. "<p></p>" or whitespace —
 * so an empty editor stores NULL rather than empty markup. */
export function isEmptyContentBody(html: string): boolean {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s|&nbsp;/g, "") === "";
}
