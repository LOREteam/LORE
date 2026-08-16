import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { normalizeAdminAuthAddress } from "../lib/adminAuth";
import { sanitizeSupportLogPayload } from "../lib/sentrySanitize";
import { safeToFixed } from "../lib/utils";

export function describeAdminClientError(error: unknown) {
  let message = "";
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    message = "";
  }
  return String(sanitizeSupportLogPayload(message)).replace(/\s+/g, " ").trim().slice(0, 220)
    || "Admin operation failed";
}

export function formatAdminPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  return `${safeToFixed(value, 2, "...")}%`;
}

export function formatAdminAge(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return "...";
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${safeToFixed(seconds, 1, "...")} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${safeToFixed(minutes, 1, "...")} min`;
  return `${safeToFixed(minutes / 60, 1, "...")} h`;
}

export function formatAdminGib(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return "...";
  return `${safeToFixed(value / 1_073_741_824, 2, "...")} GiB`;
}

export function formatAdminWholePercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "...";
  return `${safeToFixed(value, 0, "...")}%`;
}

type AdminOpsButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">;

export function AdminOpsButton(props: AdminOpsButtonProps) {
  return <button {...props} type="button" />;
}

export function normalizeConnectedAdminAddresses(values: readonly unknown[]) {
  const normalized = new Set<string>();
  for (const value of values) {
    const address = normalizeAdminAuthAddress(value);
    if (address) normalized.add(address);
  }
  return [...normalized];
}

type AdminOpsExternalLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel">;

export function AdminOpsExternalLink(props: AdminOpsExternalLinkProps) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}
