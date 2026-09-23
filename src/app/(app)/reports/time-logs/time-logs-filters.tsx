"use client";

import { useState } from "react";
import type { TimeLogParams, TimeLogPeriod } from "@/lib/reports";

const PERIODS: { value: TimeLogPeriod; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom Range" },
];

const fieldClass =
  "min-h-11 rounded-md border border-gs-gray/30 px-3 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red";

type Option = { id: string; name: string };

export function TimeLogsFilters({
  projects,
  assignees,
  params,
}: {
  projects: Option[];
  assignees: Option[];
  params: TimeLogParams;
}) {
  const [period, setPeriod] = useState<TimeLogPeriod>(params.period);

  return (
    <form method="get" className="mt-6 rounded-lg border border-gs-gray/15 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gs-gray">Project</span>
          <select name="projectId" defaultValue={params.projectId} className={fieldClass}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gs-gray">Assignee</span>
          <select name="assigneeId" defaultValue={params.assigneeId} className={fieldClass}>
            <option value="">Everyone</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gs-gray">Period</span>
          <select
            name="period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as TimeLogPeriod)}
            className={fieldClass}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>

      {period === "custom" && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-gs-gray">From</span>
            <input type="date" name="from" defaultValue={params.from} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-gs-gray">To</span>
            <input type="date" name="to" defaultValue={params.to} className={fieldClass} />
          </label>
        </div>
      )}

      <button
        type="submit"
        className="mt-4 flex min-h-11 items-center justify-center self-start rounded-md bg-gs-red px-5 text-sm font-medium text-white hover:opacity-90"
      >
        Apply
      </button>
    </form>
  );
}
