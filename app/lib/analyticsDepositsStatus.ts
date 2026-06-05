export function formatDepositFreshnessLabel(lastLoadedAt: number | null, now = Date.now()) {
  if (!lastLoadedAt || !Number.isFinite(lastLoadedAt)) return null;

  const ageMs = Math.max(0, now - lastLoadedAt);
  if (ageMs < 30_000) return "Updated now";

  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  return `Updated ${minutes}m ago`;
}
