import { JackpotPreviewClient } from "./JackpotPreviewClient";

type Variant = "daily" | "weekly" | "dual";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function resolveVariant(raw: string | string[] | undefined): Variant {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "weekly" || value === "dual") return value;
  return "daily";
}

export default async function JackpotPreviewPage({ searchParams }: Props) {
  const params = await searchParams;
  return <JackpotPreviewClient initialVariant={resolveVariant(params.variant)} />;
}
