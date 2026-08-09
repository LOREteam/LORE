export {};

function normalizeProductionOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    if (
      !host.includes(".") ||
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::" ||
      host === "::1" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".example") ||
      host.endsWith(".test") ||
      host.endsWith(".invalid") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^192\.0\.2\./.test(host) ||
      /^198\.(1[89])\./.test(host) ||
      /^198\.51\.100\./.test(host) ||
      /^203\.0\.113\./.test(host) ||
      /^f[cd][0-9a-f]*:/i.test(host) ||
      /^fe80:/i.test(host) ||
      /^2001:db8:/i.test(host)
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function getTrustedAuthOrigin(requestUrl: string, nodeEnv = process.env.NODE_ENV): string | null {
  if (nodeEnv !== "production") {
    try {
      return new URL(requestUrl).origin;
    } catch {
      return null;
    }
  }

  return normalizeProductionOrigin((process.env.NEXT_PUBLIC_SITE_URL ?? "https://playlore.xyz").trim());
}

export function isTrustedAuthUri(uri: string, trustedOrigin: string, expectedPathname: "/admin" | "/chat"): boolean {
  try {
    const parsed = new URL(uri);
    return (
      parsed.origin === trustedOrigin &&
      parsed.pathname === expectedPathname &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}
