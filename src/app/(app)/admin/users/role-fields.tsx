"use client";

import { useState } from "react";

type ClusterWithPods = {
  id: string;
  name: string;
  pods: { id: string; name: string }[];
};

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "CLUSTER_HEAD", label: "Cluster Head" },
  { value: "LEAD", label: "Lead" },
  { value: "ACCOUNT_CLIENT_SERVICES", label: "Account/Client Services" },
  { value: "CONTRIBUTOR", label: "Contributor" },
  { value: "ACCOUNTANT", label: "Accountant" },
];

// Cross-cutting roles, like Admin — not tied to any cluster or pod.
const UNSCOPED_ROLES = ["ADMIN", "ACCOUNTANT"];

export function RoleFields({ clusters }: { clusters: ClusterWithPods[] }) {
  const [role, setRole] = useState("CONTRIBUTOR");
  const [clusterId, setClusterId] = useState<string>("");

  const selectedCluster = clusters.find((c) => c.id === clusterId);
  const needsCluster = !UNSCOPED_ROLES.includes(role);
  // ACS may be cluster-less (PRD v1.26): a view-only coordinator (Dependency Tracker) with no
  // cluster oversight. The cluster is therefore optional for ACS, still required for the rest.
  const clusterOptional = role === "ACCOUNT_CLIENT_SERVICES";
  const canHavePod = role === "LEAD" || role === "CONTRIBUTOR";
  const isClusterHead = role === "CLUSTER_HEAD";

  return (
    <div className="flex flex-col gap-4 rounded-md border border-gs-gray/15 bg-gs-light p-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="role" className="text-sm font-medium">Role</label>
        <select
          id="role"
          name="role"
          value={role}
          required
          onChange={(e) => setRole(e.target.value)}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {needsCluster && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="clusterId" className="text-sm font-medium">Cluster</label>
          <select
            id="clusterId"
            name="clusterId"
            value={clusterId}
            onChange={(e) => setClusterId(e.target.value)}
            required={!clusterOptional}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          >
            {clusterOptional ? (
              <option value="">None — view-only coordinator (no cluster oversight)</option>
            ) : (
              <option value="" disabled>Select a cluster</option>
            )}
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {clusterOptional && (
            <p className="text-xs text-gs-gray">
              Leave as coordinator for a Dependency Tracker (ACS ceiling, no automatic visibility); pick a
              cluster for a normal Account/Client Services owner.
            </p>
          )}
        </div>
      )}

      {needsCluster && canHavePod && selectedCluster && selectedCluster.pods.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="podId" className="text-sm font-medium">Pod (optional)</label>
          <select
            id="podId"
            name="podId"
            defaultValue=""
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          >
            <option value="">No specific pod</option>
            {selectedCluster.pods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {needsCluster && isClusterHead && selectedCluster && selectedCluster.pods.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Pod Restriction (optional)</label>
          <p className="text-xs text-gs-gray">
            Left blank: full-cluster access. Select one or more pods to narrow every Cluster
            Head privilege (edit projects, attach/remove Task Groups, assign Account
            Manager, view Task Groups, view time-log detail, view cost/margin data, export
            reports) to only those pods — nothing else in the cluster stays visible or manageable.
          </p>
          <div className="flex flex-col gap-1">
            {selectedCluster.pods.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="restrictedPodIds" value={p.id} />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
