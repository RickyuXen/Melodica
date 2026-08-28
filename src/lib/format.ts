/** Format milliseconds as m:ss for the seek readout. */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Human-readable language name from a BCP-47 code. */
export function languageLabel(code: string): string {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Primary language subtag (`en-US` → `en`). */
export function primaryLanguageTag(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const primary = code.trim().toLowerCase().split(/[-_]/)[0];
  return primary || null;
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}
