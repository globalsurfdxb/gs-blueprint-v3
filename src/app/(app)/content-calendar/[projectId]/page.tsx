import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canManageContentCalendar, canViewContentCalendar, SOCIAL_MEDIA_POD_NAME, CONTENT_POD_NAME } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createCalendarEntry, updateCalendarEntryDate, updateCalendarEntryTitle } from "@/lib/actions/content-calendar";
import { upsertMonthlyBrief } from "@/lib/actions/monthly-briefs";
import { MONTH_NAMES } from "@/lib/format";
import { MonthYearPicker } from "./month-year-picker";
import { MonthlyBriefForm } from "./monthly-brief-form";
import { AddEntryForm } from "./add-entry-form";
import { CalendarGrid } from "./calendar-grid";
import { EditEntryDate } from "./edit-entry-date";
import { EditEntryTitle } from "./edit-entry-title";

export default async function ContentCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ month?: string; year?: string; view?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { projectId } = await params;
  const { month: monthParam, year: yearParam, view: viewParam } = await searchParams;

  const now = new Date();
  const month = Number(monthParam) || now.getMonth() + 1;
  const year = Number(yearParam) || now.getFullYear();
  const view = viewParam === "calendar" ? "calendar" : "list";

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { client: true },
  });
  if (!project) notFound();

  const socialMediaGroup = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: SOCIAL_MEDIA_POD_NAME } },
    include: { lead: true },
  });
  if (!canViewContentCalendar(user, socialMediaGroup)) {
    redirect("/content-calendar");
  }
  // Admin + the Social Media Lead can add entries, reschedule, and edit the Monthly Brief;
  // an overseeing Cluster Head (Ashna) can view and edit topics only.
  const canManage = canManageContentCalendar(user, socialMediaGroup);

  if (!socialMediaGroup) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <p className="mt-4 text-sm text-gs-gray">
          No Social Media Task Group is attached to this project yet — attach one from the project page
          before creating a Content Calendar for it.
        </p>
      </div>
    );
  }

  // The Social Media Lead plans the calendar and owns the Monthly Brief, but each entry's
  // task is created in the project's Content Task Group (a distinct production stage) —
  // that group must be attached too before entries can be added.
  const contentGroup = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: CONTENT_POD_NAME } },
    include: { lead: true },
  });
  if (!contentGroup) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <p className="mt-4 text-sm text-gs-gray">
          No Content Task Group is attached to this project yet — attach one from the project page before
          adding calendar entries (they&apos;re created there, not in Social Media&apos;s own group).
        </p>
      </div>
    );
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  const [monthlyBrief, entries, contentTypes] = await Promise.all([
    prisma.monthlyBrief.findUnique({ where: { projectId_month_year: { projectId, month, year } } }),
    prisma.task.findMany({
      where: { projectId, groupId: contentGroup.id, publishDate: { gte: monthStart, lt: monthEnd } },
      include: { contentType: true },
      orderBy: { publishDate: "asc" },
    }),
    prisma.contentType.findMany({ orderBy: { name: "asc" } }),
  ]);

  const upsertBriefWithId = upsertMonthlyBrief.bind(null, projectId);
  const createEntryWithId = createCalendarEntry.bind(null, projectId);

  // Preserve the selected month/year when switching views.
  const viewHref = (v: "list" | "calendar") => `?view=${v}&month=${month}&year=${year}`;
  const toggleBase = "flex min-h-11 items-center rounded-md px-4 text-sm font-medium";
  const activeToggle = "bg-gs-red text-white";
  const inactiveToggle = "border border-gs-gray/30 hover:bg-gs-light";

  const calendarEntries = entries.map((t) => ({
    id: t.id,
    projectId,
    title: t.name,
    contentType: t.contentType?.name ?? null,
    day: Number(t.publishDate!.toISOString().slice(8, 10)),
  }));

  return (
    <div className={view === "calendar" ? "max-w-5xl" : "max-w-2xl"}>
      <p className="text-sm text-gs-gray">{project.client.name}</p>
      <h1 className="text-xl font-semibold">{project.name} · Content Calendar</h1>
      <p className="mt-1 text-sm text-gs-gray">
        Social Media Lead: {socialMediaGroup.lead.name} · Content Lead: {contentGroup.lead.name}
      </p>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <MonthYearPicker month={month} year={year} monthNames={MONTH_NAMES} view={view} />
        <div className="flex gap-2">
          <Link href={viewHref("list")} className={`${toggleBase} ${view === "list" ? activeToggle : inactiveToggle}`}>
            List
          </Link>
          <Link href={viewHref("calendar")} className={`${toggleBase} ${view === "calendar" ? activeToggle : inactiveToggle}`}>
            Calendar
          </Link>
        </div>
      </div>

      {view === "calendar" ? (
        <div className="mt-6">
          <h2 className="font-heading text-2xl font-semibold">
            {MONTH_NAMES[month - 1]} <span className="font-normal text-gs-gray">| {year}</span>
          </h2>
          <div className="mt-3">
            <CalendarGrid month={month} year={year} entries={calendarEntries} />
          </div>
          <p className="mt-2 text-xs text-gs-gray">
            Each entry shows its Content Type — open it for the topic and full details (or hover on desktop for a
            quick peek). Switch to List to edit the Monthly Brief or add entries.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-lg border border-gs-gray/15 bg-white p-4">
            <h2 className="text-sm font-semibold uppercase text-gs-gray">
              Monthly Brief — {MONTH_NAMES[month - 1]} {year}
            </h2>
            <p className="mt-1 text-xs text-gs-gray">
              Shown read-only on every task generated from this month&apos;s calendar.
            </p>
            <div className="mt-3">
              {canManage ? (
                <MonthlyBriefForm month={month} year={year} defaultText={monthlyBrief?.text ?? ""} action={upsertBriefWithId} />
              ) : monthlyBrief?.text ? (
                <p className="whitespace-pre-wrap text-sm text-gs-gray">{monthlyBrief.text}</p>
              ) : (
                <p className="text-sm text-gs-gray">No brief set for this month yet.</p>
              )}
            </div>
          </div>

          <div className="mt-6">
            <h2 className="text-sm font-semibold uppercase text-gs-gray">Entries</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3">Date</th>
                      <th className="whitespace-nowrap px-4 py-3">Day</th>
                      <th className="whitespace-nowrap px-4 py-3">Topic/Title</th>
                      <th className="whitespace-nowrap px-4 py-3">Content Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-gs-gray">
                          No entries yet for {MONTH_NAMES[month - 1]} {year}.
                        </td>
                      </tr>
                    )}
                    {entries.map((t) => (
                      <tr key={t.id} className="border-t border-gs-gray/10">
                        <td className="whitespace-nowrap px-4 py-3 text-gs-gray">
                          <EditEntryDate
                            publishDateIso={t.publishDate!.toISOString().slice(0, 10)}
                            contentLeadTimeDays={t.contentType?.contentLeadTimeDays ?? 0}
                            editable={canManage && t.status !== "COMPLETED"}
                            action={updateCalendarEntryDate.bind(null, projectId, t.id)}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gs-gray">
                          {t.publishDate!.toLocaleDateString("en-US", { weekday: "short" })}
                        </td>
                        <td className="px-4 py-3">
                          <EditEntryTitle
                            title={t.name}
                            taskHref={`/projects/${projectId}/tasks/${t.id}`}
                            editable={t.status !== "COMPLETED"}
                            action={updateCalendarEntryTitle.bind(null, projectId, t.id)}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{t.contentType?.name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="mt-6 rounded-lg border border-gs-gray/15 bg-white p-4">
              <h2 className="text-sm font-semibold uppercase text-gs-gray">Add Entry</h2>
              <div className="mt-3">
                <AddEntryForm
                  contentTypes={contentTypes.map((ct) => ({
                    id: ct.id,
                    name: ct.name,
                    contentLeadTimeDays: ct.contentLeadTimeDays,
                  }))}
                  action={createEntryWithId}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
