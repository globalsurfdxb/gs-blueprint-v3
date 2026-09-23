import Link from "next/link";

export type CalendarEntry = {
  id: string;
  projectId: string;
  title: string;
  contentType: string | null;
  day: number;
};

// Monday-start week, matching the reference layout. Short single-letter forms are used on
// mobile so all seven columns fit the viewport without horizontal scrolling.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_SHORT = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Minimalist month grid for the Content Calendar. Each entry renders as a red chip labelled
 * with its Content Type; the chip's native title tooltip surfaces the post title on hover and
 * it links through to the task. Purely presentational — no client JS needed for the hover.
 */
export function CalendarGrid({
  month,
  year,
  entries,
}: {
  month: number; // 1-12
  year: number;
  entries: CalendarEntry[];
}) {
  // All UTC-based so the day math lines up with how publish dates are stored/displayed.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstIndex = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // Mon = 0

  const byDay = new Map<number, CalendarEntry[]>();
  for (const e of entries) {
    const arr = byDay.get(e.day) ?? [];
    arr.push(e);
    byDay.set(e.day, arr);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstIndex; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="overflow-x-auto">
      {/* No min-width on mobile: all seven columns shrink to fit the viewport so the whole
          month is visible at a glance. From sm up they get a comfortable minimum and scroll. */}
      <div className="sm:min-w-[720px]">
        <div className="grid grid-cols-7 border-l border-t border-gs-gray/15">
          {WEEKDAYS.map((w, i) => (
            <div
              key={i}
              className="border-b border-r border-gs-gray/15 px-1 py-2 text-center text-xs font-medium uppercase tracking-wide text-gs-gray sm:px-2 sm:text-left"
            >
              <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
              <span className="hidden sm:inline">{w}</span>
            </div>
          ))}
          {cells.map((d, i) => (
            <div
              key={i}
              className={`min-h-16 border-b border-r border-gs-gray/15 p-1 align-top sm:min-h-24 sm:p-2 ${d === null ? "bg-gs-light/40" : "bg-white"}`}
            >
              {d !== null && (
                <>
                  <div className="text-xs text-gs-gray sm:text-sm">{d}</div>
                  <div className="mt-1 flex flex-col gap-1">
                    {(byDay.get(d) ?? []).map((e) => (
                      <Link
                        key={e.id}
                        href={`/projects/${e.projectId}/tasks/${e.id}`}
                        title={e.title}
                        className="block truncate rounded bg-gs-red/10 px-1 py-0.5 text-[10px] font-medium text-gs-red hover:bg-gs-red/20 sm:px-1.5 sm:text-xs"
                      >
                        {e.contentType ?? "Post"}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
