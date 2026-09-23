import "server-only";

// Dependency Tracker visibility (PRD 8.13, refined per Faisal's v1.26 feedback): a coordinator
// sees a project's CROSS-department work — every task whose discipline differs from the
// project's own home discipline — hiding the home-discipline tasks, regardless of whether a
// formal Cross-Group Handoff link exists. The home discipline is derived from the project's
// Service Type (e.g. an "SEO" project's home discipline is the SEO pod).
const SERVICE_TYPE_HOME_POD: Record<string, string> = {
  SEO: "SEO",
  "Performance Marketing": "Performance",
  "Social Media": "Social Media",
  "Web/App Dev": "Dev",
  "Design/Creative": "Design",
};

/** The project's home-discipline pod name for a given Service Type, or null if the Service Type
 * doesn't map to a known discipline. */
export function homeDisciplinePod(serviceTypeName: string): string | null {
  return SERVICE_TYPE_HOME_POD[serviceTypeName] ?? null;
}

/**
 * Is this task cross-department for its project — i.e. does its discipline (Task Group pod)
 * differ from the project's home discipline? Ungrouped tasks have no discipline and never count.
 * If the home discipline can't be resolved from the Service Type, every grouped task is treated
 * as cross-department (better to over-include for a view-only tracker than hide real work) —
 * flagged so the Service-Type→discipline map stays complete.
 */
export function isCrossDepartmentTask(serviceTypeName: string, podName: string | null | undefined): boolean {
  if (!podName) return false;
  const home = homeDisciplinePod(serviceTypeName);
  if (home === null) return true;
  return podName !== home;
}
