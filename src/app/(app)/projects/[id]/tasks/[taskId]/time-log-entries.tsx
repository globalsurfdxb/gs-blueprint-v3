"use client";

import { Fragment, useState } from "react";
import { formatLocalDate, formatLocalTime, utcToLocalInput } from "@/lib/timezone";
import { formatDuration, secondsSince } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";

type TimeLogRow = {
  id: string;
  startTime: Date;
  endTime: Date | null;
  durationSeconds: number | null;
  user: { name: string };
  editedAt: Date | null;
  editReason: string | null;
  editedBy: { name: string } | null;
  originalStartTime: Date | null;
  originalEndTime: Date | null;
  originalDurationSeconds: number | null;
};

function EditRow({
  log,
  location,
  editAction,
  onClose,
}: {
  log: TimeLogRow;
  location: string;
  editAction: (timeLogId: string, formData: FormData) => void;
  onClose: () => void;
}) {
  const inputClass = "rounded-md border border-gs-gray/30 px-2 py-1 text-sm";
  return (
    <tr className="border-t border-gs-gray/10 bg-gs-light/40">
      <td colSpan={6} className="px-4 py-3">
        <ActionForm
          action={editAction.bind(null, log.id)}
          successMessage="Time entry updated."
          onSuccess={onClose}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">Start</label>
            <input
              type="datetime-local"
              name="startTime"
              required
              defaultValue={utcToLocalInput(log.startTime, location)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">End</label>
            <input
              type="datetime-local"
              name="endTime"
              required
              defaultValue={log.endTime ? utcToLocalInput(log.endTime, location) : ""}
              className={inputClass}
            />
          </div>
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">Reason (required)</label>
            <input name="reason" required placeholder="Why this entry is being corrected" className={inputClass} />
          </div>
          <SubmitButton
            pendingLabel="Saving…"
            className="flex min-h-9 items-center rounded-md bg-gs-red px-3 text-sm font-medium text-white hover:opacity-90"
          >
            Save
          </SubmitButton>
          <button type="button" onClick={onClose} className="min-h-9 rounded-md px-3 text-sm text-gs-gray hover:bg-gs-light">
            Cancel
          </button>
        </ActionForm>
      </td>
    </tr>
  );
}

export function TimeLogEntries({
  logs,
  location,
  canEdit = false,
  editAction,
}: {
  logs: TimeLogRow[];
  location: string;
  canEdit?: boolean;
  editAction?: (timeLogId: string, formData: FormData) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  // Newest first.
  const sorted = [...logs].sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
            <tr>
              <th className="whitespace-nowrap px-4 py-2">Date</th>
              <th className="whitespace-nowrap px-4 py-2">Logged by</th>
              <th className="whitespace-nowrap px-4 py-2">Start</th>
              <th className="whitespace-nowrap px-4 py-2">End</th>
              <th className="whitespace-nowrap px-4 py-2">Duration</th>
              {canEdit && <th className="whitespace-nowrap px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((log) => {
              const duration = log.durationSeconds ?? secondsSince(log.startTime);
              const edited = log.editedAt !== null;
              return (
                <Fragment key={log.id}>
                <tr className="border-t border-gs-gray/10 align-top">
                  <td className="whitespace-nowrap px-4 py-2">{formatLocalDate(log.startTime, location)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{log.user.name}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{formatLocalTime(log.startTime, location)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gs-gray">
                    {log.endTime ? formatLocalTime(log.endTime, location) : <span className="text-gs-red">In progress</span>}
                  </td>
                  <td className="px-4 py-2 font-medium">
                    {formatDuration(duration)}
                    {edited && (
                      <div className="mt-1 text-xs font-normal text-amber-600">
                        edited{log.editedBy ? ` by ${log.editedBy.name}` : ""}
                        {log.editReason ? ` — ${log.editReason}` : ""}
                        {log.originalStartTime && log.originalEndTime && (
                          <div className="text-gs-gray line-through">
                            was {formatLocalTime(log.originalStartTime, location)}–
                            {formatLocalTime(log.originalEndTime, location)}
                            {log.originalDurationSeconds != null && ` (${formatDuration(log.originalDurationSeconds)})`}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {log.endTime && editingId !== log.id && (
                        <button
                          type="button"
                          onClick={() => setEditingId(log.id)}
                          className="text-xs font-medium text-gs-red hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {canEdit && editingId === log.id && editAction && (
                  <EditRow log={log} location={location} editAction={editAction} onClose={() => setEditingId(null)} />
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
