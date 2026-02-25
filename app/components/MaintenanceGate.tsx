"use client";

import { MaintenanceOverlay } from "./MaintenanceOverlay";

const MAINTENANCE_MODE = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "1" || process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "true";

export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  if (MAINTENANCE_MODE) {
    return <MaintenanceOverlay />;
  }
  return <>{children}</>;
}
