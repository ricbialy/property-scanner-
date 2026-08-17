"use client";

import { useCallback, useEffect, useState } from "react";

import { api, API_BASE_URL } from "@/lib/api";
import { Card, ErrorBanner } from "@/components/ui";

interface Diagnostics {
  appEnv: string;
  version: string;
  commit: string;
  authMode: string;
  storageDriver: string;
  externalWebhooksDisabled: boolean;
  checks: { database: string; storage: string };
  worker: {
    seenRecently: boolean;
    lastJob: {
      jobType: string;
      status: string;
      updatedAt: string;
      lastError: string | null;
    } | null;
    failedJobs: number;
    deadJobs: number;
  };
  lastUpload: { status: string; byteSize: number | null; updatedAt: string } | null;
}

function Light({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ marginRight: "1rem" }}>
      <span style={{ color: ok ? "#1d7a1d" : "#8a1f11" }}>{ok ? "●" : "●"}</span> {label}:{" "}
      <strong>{ok ? "OK" : "PROBLEM"}</strong>
    </span>
  );
}

export default function StatusPage() {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [apiLive, setApiLive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const live = await fetch(`${API_BASE_URL}/health/live`);
      setApiLive(live.ok);
    } catch {
      setApiLive(false);
    }
    try {
      setDiag(await api<Diagnostics>("/v1/diagnostics"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div>
      <ErrorBanner message={error} />
      <Card title="Testing panel">
        <p>
          <Light ok={apiLive === true} label="API" />
          {diag ? (
            <>
              <Light ok={diag.checks.database === "ok"} label="Database" />
              <Light ok={diag.checks.storage === "ok"} label="Storage" />
              <Light ok={diag.worker.seenRecently} label="Worker" />
            </>
          ) : null}
        </p>
        {diag ? (
          <table style={{ fontSize: "0.9rem" }}>
            <tbody>
              <tr>
                <td style={{ paddingRight: "1rem" }}>Environment</td>
                <td>
                  <code>
                    {diag.appEnv} · v{diag.version} · {diag.commit}
                  </code>
                </td>
              </tr>
              <tr>
                <td>Auth / storage mode</td>
                <td>
                  <code>
                    {diag.authMode} / {diag.storageDriver}
                  </code>
                </td>
              </tr>
              <tr>
                <td>External webhooks</td>
                <td>{diag.externalWebhooksDisabled ? "disabled (safe for testing)" : "ENABLED"}</td>
              </tr>
              <tr>
                <td>Last processing job</td>
                <td>
                  {diag.worker.lastJob
                    ? `${diag.worker.lastJob.jobType} — ${diag.worker.lastJob.status} at ${new Date(diag.worker.lastJob.updatedAt).toLocaleTimeString()}${diag.worker.lastJob.lastError ? ` (${diag.worker.lastJob.lastError})` : ""}`
                    : "none yet"}
                </td>
              </tr>
              <tr>
                <td>Failed / dead jobs</td>
                <td>
                  {diag.worker.failedJobs} retrying · {diag.worker.deadJobs} dead
                </td>
              </tr>
              <tr>
                <td>Last capture upload</td>
                <td>
                  {diag.lastUpload
                    ? `${diag.lastUpload.status} — ${diag.lastUpload.byteSize ?? "?"} bytes at ${new Date(diag.lastUpload.updatedAt).toLocaleTimeString()}`
                    : "none yet"}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p>Loading diagnostics…</p>
        )}
        <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>Auto-refreshes every 5 seconds.</p>
      </Card>
    </div>
  );
}
