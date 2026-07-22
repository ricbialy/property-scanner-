"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Card, ErrorBanner } from "@/components/ui";

interface Property {
  id: string;
  name: string;
  city: string | null;
}

interface Floor {
  id: string;
  name: string;
  ordinal: number;
}

interface ScanSession {
  id: string;
  status: string;
  planId: string | null;
}

interface Handoff {
  deepLinkUrl: string;
  browserFallbackUrl: string;
  expiresAt: string;
}

export function PropertyPanel({ organizationId }: { organizationId: string }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [newPropertyName, setNewPropertyName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ data: Property[] }>("/v1/properties", { organizationId });
      setProperties(result.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [organizationId]);

  useEffect(() => {
    setSelectedProperty(null);
    setFloors([]);
    setSessions([]);
    setHandoff(null);
    void refresh();
  }, [refresh]);

  async function createProperty() {
    if (!newPropertyName.trim()) return;
    try {
      await api("/v1/properties", {
        method: "POST",
        organizationId,
        body: { name: newPropertyName.trim() }
      });
      setNewPropertyName("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addFloor() {
    if (!selectedProperty) return;
    try {
      const floor = await api<Floor>(`/v1/properties/${selectedProperty}/floors`, {
        method: "POST",
        organizationId,
        body: { name: `Floor ${floors.length}`, ordinal: floors.length }
      });
      setFloors((current) => [...current, floor]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createScanSession(floorId: string) {
    if (!selectedProperty) return;
    try {
      const session = await api<ScanSession>("/v1/scan-sessions", {
        method: "POST",
        organizationId,
        idempotencyKey: crypto.randomUUID(),
        body: {
          propertyId: selectedProperty,
          floorId,
          requestedOutputs: ["normalized_json"]
        }
      });
      setSessions((current) => [...current, session]);
      const token = await api<Handoff>(`/v1/scan-sessions/${session.id}/handoff-token`, {
        method: "POST",
        organizationId
      });
      setHandoff(token);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <ErrorBanner message={error} />
      <Card title="Properties">
        {properties.length === 0 ? <p>No properties yet.</p> : null}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {properties.map((property) => (
            <li key={property.id} style={{ marginBottom: "0.4rem" }}>
              <label style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  name="property"
                  checked={selectedProperty === property.id}
                  onChange={() => {
                    setSelectedProperty(property.id);
                    setFloors([]);
                    setSessions([]);
                    setHandoff(null);
                  }}
                />{" "}
                {property.name}
                {property.city ? ` — ${property.city}` : ""}
              </label>
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input
            value={newPropertyName}
            onChange={(e) => setNewPropertyName(e.target.value)}
            placeholder="New property name"
            aria-label="New property name"
          />
          <button onClick={() => void createProperty()}>Create property</button>
        </div>
      </Card>

      {selectedProperty ? (
        <Card title="Floors & scan sessions">
          <button onClick={() => void addFloor()}>Add floor</button>
          <ul>
            {floors.map((floor) => (
              <li key={floor.id} style={{ marginBottom: "0.4rem" }}>
                {floor.name}{" "}
                <button onClick={() => void createScanSession(floor.id)}>Start scan session</button>
              </li>
            ))}
          </ul>
          {sessions.length > 0 ? (
            <ul>
              {sessions.map((session) => (
                <li key={session.id}>
                  Session <code>{session.id.slice(0, 8)}…</code> — status: {session.status}
                </li>
              ))}
            </ul>
          ) : null}
          {handoff ? (
            <div
              style={{
                background: "#eef6ee",
                border: "1px solid #bcd9bc",
                borderRadius: 8,
                padding: "0.75rem 1rem",
                marginTop: "0.75rem"
              }}
            >
              <p style={{ margin: 0 }}>
                <strong>Scan handoff ready.</strong> Open on the LiDAR device (expires{" "}
                {new Date(handoff.expiresAt).toLocaleTimeString()}):
              </p>
              <p style={{ wordBreak: "break-all", fontFamily: "monospace", fontSize: "0.8rem" }}>
                {handoff.deepLinkUrl}
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
