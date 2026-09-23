"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SaveButton } from "@/components/save-button";

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

export function EditRoleForm({
  clusters,
  defaults,
  action,
}: {
  clusters: ClusterWithPods[];
  defaults: { role: string; clusterId: string | null; podId: string | null; restrictedPodIds?: string[] };
  action: (formData: FormData) => void;
}) {
  const [role, setRole] = useState(defaults.role);
  const [clusterId, setClusterId] = useState<string>(defaults.clusterId ?? "");

  const selectedCluster = clusters.find((c) => c.id === clusterId);
  const needsCluster = !UNSCOPED_ROLES.includes(role);
  // ACS may be cluster-less (PRD v1.26): a view-only coordinator (Dependency Tracker).
  const clusterOptional = role === "ACCOUNT_CLIENT_SERVICES";
  const canHavePod = role === "LEAD" || role === "CONTRIBUTOR";
  const isClusterHead = role === "CLUSTER_HEAD";
  const restrictedPodIds = defaults.restrictedPodIds ?? [];

  return (
    <ActionForm action={action} successMessage="Role updated." className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Role</label>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="min-h-11 rounded-md border border-gs-gray/30 px-3 text-sm"
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
          <label className="text-xs font-medium text-gs-gray">Cluster</label>
          <select
            name="clusterId"
            value={clusterId}
            onChange={(e) => setClusterId(e.target.value)}
            required={!clusterOptional}
            className="min-h-11 rounded-md border border-gs-gray/30 px-3 text-sm"
          >
            {clusterOptional ? (
              <option value="">None — view-only coordinator</option>
            ) : (
              <option value="" disabled>
                Select a cluster
              </option>
            )}
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {needsCluster && canHavePod && selectedCluster && selectedCluster.pods.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gs-gray">Pod</label>
          <select
            name="podId"
            defaultValue={defaults.podId ?? ""}
            className="min-h-11 rounded-md border border-gs-gray/30 px-3 text-sm"
          >
            <option value="">No specific pod</option>
            {selectedCluster.pods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {needsCluster && isClusterHead && selectedCluster && selectedCluster.pods.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gs-gray">Pod Restriction</label>
          <div className="flex flex-wrap gap-3">
            {selectedCluster.pods.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="restrictedPodIds"
                  value={p.id}
                  defaultChecked={restrictedPodIds.includes(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <SaveButton className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light disabled:opacity-60">
        Save
      </SaveButton>
    </ActionForm>
  );
}
