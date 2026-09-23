import { SaveButton } from "@/components/save-button";

export function MonthlyBriefForm({
  month,
  year,
  defaultText,
  action,
}: {
  month: number;
  year: number;
  defaultText: string;
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="year" value={year} />
      <textarea
        name="text"
        rows={4}
        defaultValue={defaultText}
        placeholder="This month's theme, key insights, links to decks..."
        className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm"
      />
      <SaveButton className="flex min-h-11 items-center self-start rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light disabled:opacity-60">
        Save Brief
      </SaveButton>
    </form>
  );
}
