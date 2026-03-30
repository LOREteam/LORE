"use client";

export async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const raw = await response.text();
  if (!raw) return null;
  return JSON.parse(raw) as T;
}
