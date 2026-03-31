/**
 * Convert text to a Discord-compatible channel name.
 * Lowercase, alphanumeric + dashes, max 40 chars.
 */
export function slugifyChannelName(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "claude-session"
  );
}
