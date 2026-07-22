import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Property Scan",
  description: "Capture, correct, and export indoor property plans"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          background: "#f6f7f9",
          color: "#16202b"
        }}
      >
        <header style={{ background: "#16202b", color: "#fff", padding: "0.75rem 1.5rem" }}>
          <strong>Property Scan</strong>
          <span style={{ marginLeft: "0.75rem", opacity: 0.7, fontSize: "0.85rem" }}>
            development shell — measurements are preliminary estimates, not installation-ready
          </span>
        </header>
        <main style={{ maxWidth: 900, margin: "1.5rem auto", padding: "0 1rem" }}>{children}</main>
      </body>
    </html>
  );
}
