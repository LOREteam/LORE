"use client";

export type ReceiptState = "confirmed" | "pending";

export interface PendingApproveState {
  hash: `0x${string}`;
  submittedAt: number;
  nonce: number;
}

export interface PendingBetState {
  submittedAt: number;
  nonce: number;
}
