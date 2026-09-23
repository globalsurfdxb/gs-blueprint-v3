import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Round Indicator (PRD 8.2.1 v1.22): a task's position in its Cross-Group Handoff chain,
 * computed — never stored — by counting Predecessor links back to the chain start. The
 * chain-start task (no Predecessor) is Round 1; every forward handoff or Reject & Return
 * adds one Round. Distinct from Revision Count (back-and-forth within one task); the two
 * are shown separately by design. Chains are short straight lines, so a per-hop walk is
 * fine; the `seen` guard just makes a malformed cycle terminate rather than loop forever.
 */
export async function getTaskRound(task: { predecessorTaskId: string | null }): Promise<number> {
  let round = 1;
  let predId = task.predecessorTaskId;
  const seen = new Set<string>();
  while (predId && !seen.has(predId)) {
    seen.add(predId);
    round++;
    const pred = await prisma.task.findUnique({
      where: { id: predId },
      select: { predecessorTaskId: true },
    });
    if (!pred) break;
    predId = pred.predecessorTaskId;
  }
  return round;
}
