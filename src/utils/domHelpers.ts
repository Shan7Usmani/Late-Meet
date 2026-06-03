// Shared DOM utility helpers used by popup.ts and dashboard.ts

export function escapeHtml(value: string | null | undefined): string {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function sanitizeTopicStatus(status: string): "active" | "completed" | "unresolved" {
  if (status === "completed" || status === "unresolved") return status;
  return "active";
}
