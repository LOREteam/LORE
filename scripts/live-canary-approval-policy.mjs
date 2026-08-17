function assertNonNegativeWei(value, name) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`${name} must be a non-negative bigint`);
  }
}

/**
 * Keep the live-test allowance bounded to the exact amount this run plans to
 * spend for one role. Existing excess approval is an operator intervention,
 * not something a canary may silently preserve or expand.
 */
export function resolveCanaryAllowancePlan({
  currentAllowance,
  plannedSpend,
  forceApprove = false,
}) {
  assertNonNegativeWei(currentAllowance, "currentAllowance");
  assertNonNegativeWei(plannedSpend, "plannedSpend");
  if (plannedSpend === 0n) {
    return {
      allowanceWithinRunCap: true,
      approvalTarget: 0n,
      needsApproval: false,
      participant: false,
      rejectReason: null,
    };
  }

  const allowanceWithinRunCap = currentAllowance <= plannedSpend;
  if (!allowanceWithinRunCap) {
    return {
      allowanceWithinRunCap,
      approvalTarget: plannedSpend,
      needsApproval: false,
      participant: true,
      rejectReason: "existing allowance exceeds the declared run cap",
    };
  }

  return {
    allowanceWithinRunCap,
    approvalTarget: plannedSpend,
    needsApproval: forceApprove || currentAllowance !== plannedSpend,
    participant: true,
    rejectReason: null,
  };
}

export function assertCanaryApprovalPostcondition({ actualAllowance, approvalTarget }) {
  assertNonNegativeWei(actualAllowance, "actualAllowance");
  assertNonNegativeWei(approvalTarget, "approvalTarget");
  if (actualAllowance !== approvalTarget) {
    throw new Error("approval receipt did not establish the exact declared run cap");
  }
}
