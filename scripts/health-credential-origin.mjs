const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_CANONICAL_HEALTH_ORIGIN = "https://playlore.xyz";

function parseOriginOnly(value, label) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(String(value ?? "").trim());
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) origin`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be an HTTP(S) origin without credentials, path, query, or hash`);
  }
  return url;
}

function isLoopbackOrigin(url) {
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTS.has(hostname);
}

export function assertTrustedHealthCredentialOrigin({ target, canonicalOrigin, targetName }) {
  const targetUrl = parseOriginOnly(target, targetName);
  if (isLoopbackOrigin(targetUrl)) return targetUrl;

  const canonicalValue = String(canonicalOrigin ?? "").trim() || DEFAULT_CANONICAL_HEALTH_ORIGIN;
  const canonicalUrl = parseOriginOnly(canonicalValue, "NEXT_PUBLIC_SITE_URL");
  if (targetUrl.origin !== canonicalUrl.origin) {
    throw new Error(`${targetName} must exactly match NEXT_PUBLIC_SITE_URL before health credentials can be sent`);
  }
  return targetUrl;
}
