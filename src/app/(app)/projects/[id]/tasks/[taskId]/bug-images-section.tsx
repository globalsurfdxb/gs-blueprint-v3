"use client";

import { useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";

type BugImage = { id: string; url: string; filename: string };

const MAX_IMAGES = 3;

/** Full-size viewer overlaid in-app — click a thumbnail to open, then close with the ×,
 * a click on the backdrop, or Esc (so there's always an obvious way out). */
function Lightbox({ image, onClose }: { image: BugImage; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.filename}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gs-black/80 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-xl font-semibold text-gs-black hover:bg-white"
      >
        ×
      </button>
      {/* Stop propagation so clicking the image itself doesn't close the viewer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.filename}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-full rounded-md object-contain shadow-lg"
      />
    </div>
  );
}

export function BugImagesSection({
  images,
  canManage,
  uploadAction,
  removeAction,
}: {
  images: BugImage[];
  canManage: boolean;
  uploadAction: (formData: FormData) => void;
  removeAction: (imageId: string, formData: FormData) => void;
}) {
  const atLimit = images.length >= MAX_IMAGES;
  const [viewing, setViewing] = useState<BugImage | null>(null);

  return (
    <div className="mt-4 rounded-lg border border-gs-gray/15 bg-white px-4 py-3 text-sm">
      <p className="text-xs uppercase text-gs-gray">Screenshots ({images.length}/{MAX_IMAGES})</p>

      {images.length === 0 ? (
        <p className="mt-1 text-gs-gray">No screenshots attached.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-3">
          {images.map((img) => (
            <div key={img.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setViewing(img)}
                title={`${img.filename} — click to view full size`}
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.filename}
                  className="h-24 w-24 rounded-md border border-gs-gray/20 object-cover hover:opacity-90"
                />
              </button>
              {canManage && (
                <ActionForm action={removeAction.bind(null, img.id)} successMessage="Screenshot removed.">
                  <SubmitButton pendingLabel="Removing…" className="text-xs text-gs-red hover:underline">
                    Remove
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage &&
        (atLimit ? (
          <p className="mt-3 text-xs text-gs-gray">
            Maximum of {MAX_IMAGES} screenshots reached — remove one to add another.
          </p>
        ) : (
          <ActionForm action={uploadAction} successMessage="Screenshot attached." className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="file"
              name="image"
              required
              accept="image/png,image/jpeg,image/webp"
              className="text-xs file:mr-2 file:rounded-md file:border file:border-gs-gray/30 file:bg-gs-light file:px-3 file:py-1.5 file:text-xs file:font-medium"
            />
            <SubmitButton
              pendingLabel="Uploading…"
              className="flex min-h-9 items-center rounded-md border border-gs-gray/30 px-3 text-xs font-medium hover:bg-gs-light"
            >
              Upload
            </SubmitButton>
            <span className="w-full text-xs text-gs-gray">PNG, JPG or WebP · up to 5MB each.</span>
          </ActionForm>
        ))}

      {viewing && <Lightbox image={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
