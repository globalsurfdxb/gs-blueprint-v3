"use client";

import { SEVERITY_VALUES, SEVERITY_LABELS, ENVIRONMENT_VALUES, ENVIRONMENT_LABELS } from "@/lib/bug";
import { useTaskType } from "./task-type-context";

const fieldClass =
  "rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red";

/**
 * Task Type selector + Bug-only fields. Rendered only when the target Task Group's
 * discipline has Bug Tracking enabled (PRD 8.2.4) — every other discipline never sees this,
 * so their create-task screen is unchanged. Severity/Steps/Environment appear only when
 * Task Type = Bug.
 */
export function TaskTypeFields() {
  const { taskType, setTaskType } = useTaskType();
  const isBug = taskType === "BUG";

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="taskType" className="text-sm font-medium">Task Type</label>
        <select
          id="taskType"
          name="taskType"
          value={taskType}
          onChange={(e) => setTaskType(e.target.value)}
          className={fieldClass}
        >
          <option value="STANDARD">Standard</option>
          <option value="BUG">Bug</option>
        </select>
        <p className="text-xs text-gs-gray">Set once at creation — a task&apos;s type can&apos;t be changed later.</p>
      </div>

      {isBug && (
        <div className="flex flex-col gap-4 rounded-md border border-gs-gray/20 bg-gs-light/40 p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="severity" className="text-sm font-medium">Severity <span className="text-gs-gray">(impact)</span></label>
            <select id="severity" name="severity" required={isBug} defaultValue="" className={fieldClass}>
              <option value="" disabled>Select severity</option>
              {SEVERITY_VALUES.map((s) => (
                <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="environment" className="text-sm font-medium">Environment</label>
            <select id="environment" name="environment" required={isBug} defaultValue="" className={fieldClass}>
              <option value="" disabled>Select environment</option>
              {ENVIRONMENT_VALUES.map((e) => (
                <option key={e} value={e}>{ENVIRONMENT_LABELS[e]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="stepsToReproduce" className="text-sm font-medium">
              Steps to Reproduce <span className="text-gs-gray">(optional)</span>
            </label>
            <textarea id="stepsToReproduce" name="stepsToReproduce" rows={3} className={fieldClass} />
          </div>
        </div>
      )}
    </>
  );
}
