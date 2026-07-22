import type { ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #dde2e8",
        borderRadius: 8,
        padding: "1rem 1.25rem",
        marginBottom: "1.25rem"
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>{title}</h2>
      {children}
    </section>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        background: "#fdecea",
        border: "1px solid #f5c6c0",
        color: "#8a1f11",
        borderRadius: 8,
        padding: "0.6rem 1rem",
        marginBottom: "1rem"
      }}
    >
      ⚠ {message}
    </div>
  );
}
