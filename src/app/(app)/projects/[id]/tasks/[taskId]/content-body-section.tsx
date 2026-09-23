"use client";

import { useEffect, useRef } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";

// Shared prose styling for the rendered copy — maps the allowed tags (h2/h3/ul/ol/li/p/strong/
// em) to readable spacing. The stored HTML is already server-sanitized to exactly these tags.
const PROSE =
  "text-sm leading-relaxed [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5";

const TOOLBAR: { label: string; title: string; cmd: string; arg?: string }[] = [
  { label: "B", title: "Bold", cmd: "bold" },
  { label: "I", title: "Italic", cmd: "italic" },
  { label: "H2", title: "Heading", cmd: "formatBlock", arg: "h2" },
  { label: "H3", title: "Subheading", cmd: "formatBlock", arg: "h3" },
  { label: "• List", title: "Bullet list", cmd: "insertUnorderedList" },
  { label: "1. List", title: "Numbered list", cmd: "insertOrderedList" },
];

function ContentBodyEditor({
  initialHtml,
  action,
}: {
  initialHtml: string | null;
  action: (formData: FormData) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  // Seed the contentEditable via a ref (not React children / dangerouslySetInnerHTML) so React
  // never "owns" the live markup and can't clobber the user's edits on a re-render.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml ?? "";
    if (hiddenRef.current) hiddenRef.current.value = initialHtml ?? "";
  }, [initialHtml]);

  function sync() {
    if (hiddenRef.current && editorRef.current) hiddenRef.current.value = editorRef.current.innerHTML;
  }

  function apply(cmd: string, arg?: string) {
    editorRef.current?.focus();
    // execCommand is deprecated but is the dependency-free way to do basic rich-text in a
    // contentEditable; the result is sanitized server-side regardless of what it produces.
    document.execCommand(cmd, false, arg);
    sync();
  }

  return (
    <ActionForm action={action} successMessage="Content Body saved." className="mt-2">
      <div className="flex flex-wrap gap-1 rounded-t-md border border-b-0 border-gs-gray/25 bg-gs-light px-2 py-1.5">
        {TOOLBAR.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.title}
            onMouseDown={(e) => e.preventDefault() /* keep the selection in the editor */}
            onClick={() => apply(t.cmd, t.arg)}
            className="min-h-8 rounded px-2 text-xs font-semibold text-gs-gray hover:bg-white hover:text-gs-black"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        role="textbox"
        aria-multiline="true"
        aria-label="Content Body"
        className={`min-h-40 max-h-[28rem] overflow-y-auto break-words rounded-b-md border border-gs-gray/25 bg-white px-3 py-2 outline-none focus:border-gs-red ${PROSE}`}
      />
      <input ref={hiddenRef} type="hidden" name="contentBody" />
      <div className="mt-2">
        <SubmitButton
          pendingLabel="Saving…"
          className="flex min-h-9 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light"
        >
          Save Content Body
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * Content Body (PRD 8.12): the copy itself, on Content-discipline tasks only. The current
 * assignee edits it in a WYSIWYG editor; everyone else with task visibility reads it. The
 * stored value is server-sanitized to basic formatting, so rendering it as HTML is safe.
 */
export function ContentBodySection({
  html,
  canManage,
  action,
}: {
  html: string | null;
  canManage: boolean;
  action: (formData: FormData) => void;
}) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold uppercase text-gs-gray">Content Body</h2>
      {canManage ? (
        <ContentBodyEditor initialHtml={html} action={action} />
      ) : html ? (
        <div
          className={`mt-2 max-h-[28rem] overflow-y-auto break-words rounded-lg border border-gs-gray/15 bg-white px-4 py-3 ${PROSE}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="mt-2 text-sm text-gs-gray">No content yet.</p>
      )}
    </div>
  );
}
