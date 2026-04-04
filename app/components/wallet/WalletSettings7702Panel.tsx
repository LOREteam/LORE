"use client";

import React from "react";
import type { Eip7702DiagnosticState } from "../../hooks/usePrivy7702Diagnostics";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";

interface WalletSettings7702PanelProps {
  eip7702Diagnostic: Eip7702DiagnosticState;
  onRunEip7702Diagnostic: () => Promise<void>;
  onRunEip7702SendDiagnostic: () => Promise<void>;
}

export function WalletSettings7702Panel({
  eip7702Diagnostic,
  onRunEip7702Diagnostic,
  onRunEip7702SendDiagnostic,
}: WalletSettings7702PanelProps) {
  const diagnosticToneClass =
    eip7702Diagnostic.status === "success"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : eip7702Diagnostic.status === "error"
        ? "border-red-500/20 bg-red-500/5"
        : "border-violet-500/15 bg-black/20";

  return (
    <UiPanel tone="accent" className="animate-slide-up" style={{ animationDelay: "0.08s" }}>
      <div className={`rounded-lg border p-3 ${diagnosticToneClass}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">7702 diagnostic</div>
            <div className="mt-1 text-[11px] text-gray-500">
              Checks delegation signing and real type-4 send behavior without using the betting UI.
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <UiButton
              onClick={() => {
                void onRunEip7702Diagnostic();
              }}
              variant={eip7702Diagnostic.status === "error" ? "warning" : "secondary"}
              size="sm"
              uppercase
              loading={eip7702Diagnostic.status === "running" && eip7702Diagnostic.stage !== "send"}
            >
              Test 7702
            </UiButton>
            <UiButton
              onClick={() => {
                void onRunEip7702SendDiagnostic();
              }}
              variant={eip7702Diagnostic.status === "error" && eip7702Diagnostic.stage === "send" ? "warning" : "ghost"}
              size="sm"
              uppercase
              loading={eip7702Diagnostic.status === "running" && eip7702Diagnostic.stage === "send"}
            >
              Test Send
            </UiButton>
          </div>
        </div>

        <div className="mt-2 space-y-1 text-[11px]">
          <div className="text-gray-300">
            Status:{" "}
            <span className="font-semibold text-white">
              {eip7702Diagnostic.summary ?? (eip7702Diagnostic.status === "idle" ? "Not tested yet." : "Running...")}
            </span>
          </div>
          {eip7702Diagnostic.stage !== "idle" && <div className="text-gray-500">Stage: {eip7702Diagnostic.stage}</div>}
          {eip7702Diagnostic.gasEstimate && (
            <div className="text-emerald-300">Estimated gas: {eip7702Diagnostic.gasEstimate}</div>
          )}
          {eip7702Diagnostic.txHash && (
            <div className="text-emerald-300 break-all">Tx hash: {eip7702Diagnostic.txHash}</div>
          )}
          {eip7702Diagnostic.detail && (
            <div className={eip7702Diagnostic.status === "error" ? "text-red-300/90 break-words" : "text-gray-400 break-words"}>
              {eip7702Diagnostic.detail}
            </div>
          )}
        </div>
      </div>
    </UiPanel>
  );
}
