/** Map a resolution URL to a Sibyl entity name (identifier-safe). */

export function sourceKeyFromUrl(url: string): { host: string; key: string } {
  let host = "unknown-source";
  const trimmed = (url ?? "").trim();
  if (trimmed) {
    try {
      const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      if (parsed.hostname) host = parsed.hostname.toLowerCase();
    } catch {
      host = "unknown-source";
    }
  }
  const key = host
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 200);
  return { host, key: key || "unknown-source" };
}

export const TENANTS = {
  oracle: "mimir-oracle",
  creator: "mimir-creator",
  council: (slug: string) => `mimir-council-${slug}`,
  trader: (id: string) => `mimir-trader-${id}`,
} as const;

export const SOURCE_CATEGORY = "source";
