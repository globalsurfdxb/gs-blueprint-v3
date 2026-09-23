export function MonthYearPicker({
  month,
  year,
  monthNames,
  view,
}: {
  month: number;
  year: number;
  monthNames: string[];
  view?: string;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      {view && <input type="hidden" name="view" value={view} />}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Month</label>
        <select
          name="month"
          defaultValue={month}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm"
        >
          {monthNames.map((name, i) => (
            <option key={name} value={i + 1}>{name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Year</label>
        <input
          name="year"
          type="number"
          defaultValue={year}
          className="w-24 rounded-md border border-gs-gray/30 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light"
      >
        Go
      </button>
    </form>
  );
}
