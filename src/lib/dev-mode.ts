// Detect dev mode at runtime (preview/local) vs production deploy.
export function isDevMode(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h === "localhost" ||
    h.startsWith("127.") ||
    h.includes("id-preview--") ||
    h.includes("-dev.lovable.app") ||
    h.endsWith(".lovable.dev")
  );
}
