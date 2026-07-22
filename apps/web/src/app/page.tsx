"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Card, ErrorBanner } from "@/components/ui";
import { PropertyPanel } from "@/components/PropertyPanel";

interface Organization {
  id: string;
  name: string;
  role: string;
}

export default function DashboardPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ data: Organization[] }>("/v1/organizations");
      setOrganizations(result.data);
      setSelectedOrg((current) => current ?? result.data[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createOrganization() {
    if (!newOrgName.trim()) return;
    try {
      await api("/v1/organizations", { method: "POST", body: { name: newOrgName.trim() } });
      setNewOrgName("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <ErrorBanner message={error} />
      <Card title="Organizations">
        {organizations.length === 0 ? (
          <p>No organizations yet. Create one to get started.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {organizations.map((org) => (
              <li key={org.id} style={{ marginBottom: "0.4rem" }}>
                <label style={{ cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="org"
                    checked={selectedOrg === org.id}
                    onChange={() => setSelectedOrg(org.id)}
                  />{" "}
                  <strong>{org.name}</strong>{" "}
                  <span style={{ opacity: 0.6, fontSize: "0.85rem" }}>({org.role})</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            placeholder="New organization name"
            aria-label="New organization name"
          />
          <button onClick={() => void createOrganization()}>Create organization</button>
        </div>
      </Card>
      {selectedOrg ? <PropertyPanel organizationId={selectedOrg} /> : null}
    </div>
  );
}
