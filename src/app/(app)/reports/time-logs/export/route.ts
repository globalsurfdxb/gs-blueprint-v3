import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { canViewHoursReport } from "@/lib/permissions";
import { getReportScope, getTimeLogReport, type TimeLogParams, type TimeLogPeriod } from "@/lib/reports";
import { formatDuration } from "@/lib/format";

// Timesheet/Hours Report — Excel (.xlsx) export (final build). Streams the SAME report the screen
// shows for the SAME user, so scope is enforced by construction: getTimeLogReport already returns
// only what this viewer may see (Contributor self-only, ACS empty, Lead/CH/Admin their scope), and
// the on-screen date range + Project filter are read straight from the query string. There is no
// way to export data the requester couldn't already see on screen.

export const runtime = "nodejs";

const PERIOD_LABEL: Record<TimeLogPeriod, string> = {
  day: "Today",
  week: "This Week",
  month: "This Month",
  custom: "Custom Range",
};

function str(v: string | null): string {
  return v ?? "";
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canViewHoursReport(user)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const periodRaw = str(sp.get("period"));
  const period: TimeLogPeriod = (["day", "week", "month", "custom"] as const).includes(periodRaw as TimeLogPeriod)
    ? (periodRaw as TimeLogPeriod)
    : "month";

  const params: TimeLogParams = {
    projectId: str(sp.get("projectId")),
    assigneeId: str(sp.get("assigneeId")),
    period,
    from: str(sp.get("from")),
    to: str(sp.get("to")),
  };

  const { label: scopeLabel } = getReportScope(user);
  const report = await getTimeLogReport(user, params);

  const wb = new ExcelJS.Workbook();
  wb.creator = "GS Blueprint";
  wb.created = new Date();
  const ws = wb.addWorksheet("Time Logs");

  ws.columns = [
    { header: "Person", key: "person", width: 24 },
    { header: "Task", key: "task", width: 40 },
    { header: "Client", key: "client", width: 24 },
    { header: "Project", key: "project", width: 28 },
    { header: "Hours", key: "hours", width: 10 },
    { header: "Time Logged", key: "duration", width: 16 },
  ];

  // Title / context block above the table (rows 1-3), then a blank row, then the header row.
  ws.spliceRows(1, 0, [`Time Logs — ${scopeLabel}`], [
    `Period: ${PERIOD_LABEL[period]} · ${report.fromLabel} – ${report.toLabel}`,
  ], [`Generated: ${report.toLabel}`], []);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(2).font = { color: { argb: "FF666666" } };
  ws.getRow(3).font = { color: { argb: "FF666666" } };

  const headerRow = ws.getRow(5);
  headerRow.font = { bold: true };
  headerRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    c.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
  });

  // Body: task rows grouped by person, a bold subtotal after each person, then a grand total.
  for (const group of report.groups) {
    for (const t of group.tasks) {
      ws.addRow({
        person: group.userName,
        task: t.taskName,
        client: t.clientName,
        project: t.projectName,
        hours: Number((t.totalSeconds / 3600).toFixed(2)),
        duration: formatDuration(t.totalSeconds),
      });
    }
    const subtotal = ws.addRow({
      person: `${group.userName} — total`,
      hours: Number((group.totalSeconds / 3600).toFixed(2)),
      duration: formatDuration(group.totalSeconds),
    });
    subtotal.font = { bold: true };
    subtotal.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAFA" } };
    });
    ws.addRow({});
  }

  const grand = ws.addRow({
    person: "GRAND TOTAL",
    hours: Number((report.grandTotalSeconds / 3600).toFixed(2)),
    duration: formatDuration(report.grandTotalSeconds),
  });
  grand.font = { bold: true };
  grand.eachCell((c) => {
    c.border = { top: { style: "double", color: { argb: "FF999999" } } };
  });

  if (report.groups.length === 0) {
    ws.addRow({ person: "No time logged in this period for the selected filters." });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = report.toLabel.replace(/\//g, "-");
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="time-logs-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
