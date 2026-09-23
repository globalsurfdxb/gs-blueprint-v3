import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canViewReports } from "@/lib/permissions";
import { getTimeByClientReport, getReportScope } from "@/lib/reports";
import { formatDuration } from "@/lib/format";

export default async function TimeByClientReportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewReports(user)) redirect("/");

  const { label } = getReportScope(user);
  const rows = await getTimeByClientReport(user);
  const grandTotal = rows.reduce((s, r) => s + r.totalSeconds, 0);

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gs-gray">
        <Link href="/reports" className="hover:underline">
          Reports
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Time by Client</h1>
        <span className="text-sm text-gs-gray">{label}</span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-gs-gray">No projects in scope yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2">Client</th>
                  <th className="whitespace-nowrap px-4 py-2">Projects</th>
                  <th className="whitespace-nowrap px-4 py-2">Time Logged</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.clientId} className="border-t border-gs-gray/10">
                    <td className="px-4 py-2 font-medium">{r.clientName}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{r.projectCount}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-gs-gray">
                      {r.totalSeconds > 0 ? formatDuration(r.totalSeconds) : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-gs-gray/15 bg-gs-light/50">
                  <td className="px-4 py-2 text-xs font-semibold uppercase text-gs-gray">Total</td>
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 font-medium">{formatDuration(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
