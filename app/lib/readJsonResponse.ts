"use client";

export async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON response: ${raw.slice(0, 120)}`);
  }
}
