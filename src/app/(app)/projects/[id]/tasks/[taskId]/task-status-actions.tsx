import { ActionForm, SubmitButton } from "@/components/action-form";

type TaskStatus = "NEW" | "IN_PROGRESS" | "REVIEW" | "REVISION" | "COMPLETED" | "ON_HOLD";

const HOLDABLE: TaskStatus[] = ["NEW", "IN_PROGRESS", "REVIEW"];

function ActionButton({
  action,
  label,
  successMessage,
  variant = "default",
}: {
  action: (formData: FormData) => void;
  label: string;
  successMessage: string;
  variant?: "default" | "primary" | "danger";
}) {
  const classes =
    variant === "primary"
      ? "bg-gs-red text-white hover:opacity-90"
      : variant === "danger"
        ? "border border-gs-red text-gs-red hover:bg-gs-red/5"
        : "border border-gs-gray/30 hover:bg-gs-light";
  return (
    <ActionForm action={action} successMessage={successMessage}>
      <SubmitButton
        pendingLabel="Working…"
        className={`flex min-h-11 items-center rounded-md px-4 text-sm font-medium ${classes}`}
      >
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function TaskStatusActions({
  status,
  taskType = "STANDARD",
  canAdvance,
  canReview,
  canHold,
  actions,
}: {
  status: TaskStatus;
  taskType?: string;
  canAdvance: boolean;
  canReview: boolean;
  canHold: boolean;
  actions: {
    startTask: (formData: FormData) => void;
    submitForReview: (formData: FormData) => void;
    approveTask: (formData: FormData) => void;
    sendToRevision: (formData: FormData) => void;
    putTaskOnHold: (formData: FormData) => void;
    resumeTaskFromHold: (formData: FormData) => void;
  };
}) {
  const buttons: React.ReactNode[] = [];
  // Bugs reuse the same transitions with relabelled buttons (PRD 8.2.4) — no new actions.
  const isBug = taskType === "BUG";

  if (status === "NEW" && canAdvance) {
    buttons.push(
      <ActionButton key="start" action={actions.startTask} label="Start Task" successMessage="Task started." variant="primary" />,
    );
  }
  if (status === "IN_PROGRESS" && canAdvance) {
    buttons.push(
      <ActionButton
        key="review"
        action={actions.submitForReview}
        label={isBug ? "Mark Ready for Retest" : "Submit for Review"}
        successMessage={isBug ? "Marked ready for retest." : "Submitted for review."}
        variant="primary"
      />,
    );
  }
  if (status === "REVIEW" && canReview) {
    buttons.push(
      <ActionButton
        key="approve"
        action={actions.approveTask}
        label={isBug ? "Close Bug" : "Approve · Complete"}
        successMessage={isBug ? "Bug closed." : "Task approved and completed."}
        variant="primary"
      />,
    );
    buttons.push(
      <ActionButton
        key="revise"
        action={actions.sendToRevision}
        label={isBug ? "Reopen" : "Send to Revision"}
        successMessage={isBug ? "Bug reopened." : "Sent back for revision."}
        variant="danger"
      />,
    );
  }
  if (status === "ON_HOLD" && canHold) {
    buttons.push(<ActionButton key="resume" action={actions.resumeTaskFromHold} label="Resume" successMessage="Task resumed." variant="primary" />);
  }
  if (HOLDABLE.includes(status) && canHold) {
    buttons.push(<ActionButton key="hold" action={actions.putTaskOnHold} label="Put On Hold" successMessage="Task put on hold." />);
  }

  if (buttons.length === 0) return null;

  return <div className="mt-4 flex flex-wrap gap-2">{buttons}</div>;
}
