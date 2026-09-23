import type { CompletionColor } from "@/lib/completion";

export type CompletionGroupRow = {
  id: string;
  name: string;
  completed: number;
  total: number;
  percent: number;
  color: CompletionColor;
};

// Colour applies to the percentage itself (same pattern as revision-count highlighting), and is
// driven by overdue/due-soon status — NOT by the percentage value.
const PERCENT_COLOR: Record<CompletionColor, string> = {
  green: "text-green-600",
  amber: "text-amber-600",
  red: "text-gs-red",
};

/**
 * Project Completion % (final build). Each attached Development/Design Task Group shown side by
 * side — never averaged into one number. A Lead sees only their own group; oversight roles see
 * every qualifying discipline. Absent entirely on projects with no Dev/Design group (the caller
 * passes an empty list, and this renders nothing).
 */
export function CompletionSection({ groups }: { groups: CompletionGroupRow[] }) {
  if (groups.length === 0) return null;

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold uppercase text-gs-gray">Completion</h2>
      <div className="mt-2 flex flex-wrap gap-3">
        {groups.map((g) => (
          <div key={g.id} className="min-w-[8rem] rounded-lg border border-gs-gray/15 bg-white px-4 py-3">
            <p className="text-xs font-medium text-gs-gray">{g.name}</p>
            {g.total === 0 ? (
              <p className="mt-1 text-sm text-gs-gray">No tasks yet</p>
            ) : (
              <p className="mt-1 flex items-baseline gap-2">
                <span className={`text-2xl font-semibold ${PERCENT_COLOR[g.color]}`}>{g.percent}%</span>
                <span className="text-xs text-gs-gray">{g.completed}/{g.total} done</span>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
