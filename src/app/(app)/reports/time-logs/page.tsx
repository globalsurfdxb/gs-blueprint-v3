import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canViewHoursReport } from "@/lib/permissions";
import {
  getReportScope,
  getTimeLogFilterOptions,
  getTimeLogReport,
  type TimeLogParams,
  type TimeLogPeriod,
} from "@/lib/reports";
import { formatDuration } from "@/lib/format";
import { TimeLogsFilters } from "./time-logs-filters";

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export default async function TimeLogsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewHoursReport(user)) redirect("/");

  const sp = await searchParams;
  const periodRaw = str(sp.period);
  const period: TimeLogPeriod = (["day", "week", "month", "custom"] as const).includes(
    periodRaw as TimeLogPeriod,
  )
    ? (periodRaw as TimeLogPeriod)
    : "month";

  const params: TimeLogParams = {
    projectId: str(sp.projectId),
    assigneeId: str(sp.assigneeId),
    period,
    from: str(sp.from),
    to: str(sp.to),
  };

  const { label } = getReportScope(user);
  const options = await getTimeLogFilterOptions(user);
  const report = await getTimeLogReport(user, params);

  // Excel export link — carries exactly the filters currently applied on screen, so the export
  // always matches what's shown (and the same scope, enforced server-side in the export route).
  const exportParams = new URLSearchParams();
  if (params.period) exportParams.set("period", params.period);
  if (params.projectId) exportParams.set("projectId", params.projectId);
  if (params.assigneeId) exportParams.set("assigneeId", params.assigneeId);
  if (params.from) exportParams.set("from", params.from);
  if (params.to) exportParams.set("to", params.to);
  const exportHref = `/reports/time-logs/export?${exportParams.toString()}`;

  return (
    <div className="max-w-4xl">
      <p className="text-sm text-gs-gray">
        <Link href="/reports" className="hover:underline">
          Reports
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Time Logs</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gs-gray">{label}</span>
          <a
            href={exportHref}
            className="flex min-h-9 items-center rounded-md border border-gs-gray/30 px-3 text-sm font-medium hover:bg-gs-light"
          >
            Export to Excel
          </a>
        </div>
      </div>

      <TimeLogsFilters projects={options.projects} assignees={options.assignees} params={params} />

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">
            {{ day: "Today", week: "This Week", month: "This Month", custom: "Custom Range" }[params.period]}
          </span>
          <span className="text-gs-gray"> · {report.fromLabel} – {report.toLabel}</span>
        </p>
        <p className="text-sm">
          <span className="text-gs-gray">Total: </span>
          <span className="font-semibold">{formatDuration(report.grandTotalSeconds)}</span>
        </p>
      </div>

      {report.groups.length === 0 ? (
        <p className="mt-6 text-sm text-gs-gray">No time logged in this period for the selected filters.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {report.groups.map((g) => (
            <div key={g.userId} className="overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
              <div className="flex items-baseline justify-between gap-2 border-b border-gs-gray/15 bg-gs-light/50 px-4 py-2">
                <span className="font-semibold">{g.userName}</span>
                <span className="text-sm font-medium">{formatDuration(g.totalSeconds)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs uppercase text-gs-gray">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2">Task</th>
                      <th className="whitespace-nowrap px-4 py-2">Client</th>
                      <th className="whitespace-nowrap px-4 py-2">Project</th>
                      <th className="whitespace-nowrap px-4 py-2">Time Logged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.tasks.map((t) => (
                      <tr key={t.taskId} className="border-t border-gs-gray/10">
                        <td className="px-4 py-2">
                          <Link
                            href={`/projects/${t.projectId}/tasks/${t.taskId}`}
                            className="font-medium hover:underline"
                          >
                            {t.taskName}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.clientName}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.projectName}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{formatDuration(t.totalSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
