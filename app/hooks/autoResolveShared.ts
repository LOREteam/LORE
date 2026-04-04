"use client";

export async function waitUnlessCancelled(cancelled: () => boolean, ms: number) {
  const sleepMs = Math.max(1_000, ms);
  await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
  return !cancelled();
}
