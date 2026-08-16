const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export const MAX_QA_VIEWPORT_MARKERS = 32;

export function parseCanonicalQaViewportDimension(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{2,3}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

export function hasMobileQaViewportProofText(text) {
  const viewportMatches = String(text ?? "").matchAll(
    /\b(?:mobile\s+viewport|viewport)\s*[:=]?\s*(\d{3,4})\s*x\s*(\d{3,4})\b/gi,
  );
  let inspected = 0;
  let hasMobileViewport = false;
  for (const match of viewportMatches) {
    inspected += 1;
    if (inspected > MAX_QA_VIEWPORT_MARKERS) return false;
    const width = parseCanonicalQaViewportDimension(match[1]);
    const height = parseCanonicalQaViewportDimension(match[2]);
    if (width == null || height == null) continue;
    const portraitMobile = width >= 320 && width <= 480 && height >= 568 && height <= 1100;
    const landscapeMobile = height >= 320 && height <= 480 && width >= 568 && width <= 1100;
    hasMobileViewport ||= portraitMobile || landscapeMobile;
  }
  return hasMobileViewport;
}

export function hasMobileQaDeviceProofText(text) {
  const normalized = String(text ?? "");
  return /\b(?:ios|android|iphone|metamask\s+mobile|rabby\s+mobile|trust\s+wallet|coinbase\s+wallet|walletconnect|in[-\s]?app\s+wallet)\b/i.test(normalized) ||
    hasMobileQaViewportProofText(normalized);
}

export function hasQaWalletContentProof(checkId, text) {
  const normalized = String(text ?? "");
  if (checkId === "privyAllowedOrigins") {
    return /\bprivy\b/i.test(normalized) &&
      /\b(?:allowed[-\s]?origin|dashboard|production\s+origin)\b/i.test(normalized) &&
      /\bapp[-\s]?id\b/i.test(normalized);
  }
  if (checkId === "desktopConnect") {
    return /\b(?:desktop|browser)\b/i.test(normalized) &&
      /\b(?:connect|connected|wallet\s+ready)\b/i.test(normalized);
  }
  if (checkId === "desktopDisconnect") {
    return /\b(?:desktop|browser)\b/i.test(normalized) &&
      /\b(?:disconnect|disconnected|sign\s*out|log\s*out)\b/i.test(normalized);
  }
  if (checkId === "desktopReconnect") {
    return /\b(?:desktop|browser)\b/i.test(normalized) &&
      /\b(?:reconnect|reload|session\s+recovery|wallet\s+ready)\b/i.test(normalized);
  }
  if (checkId === "wrongNetwork") {
    return /\bwrong\s+network|unsupported\s+chain|switch\s+network|chain\s+mismatch\b/i.test(normalized);
  }
  if (checkId === "mobileWeb3Browser") {
    return /\bmobile\b/i.test(normalized) && /\b(?:web3|in[-\s]?app|browser|wallet)\b/i.test(normalized);
  }
  if (checkId === "cleanWalletFirstTx") {
    return /\bclean\s+wallet|first\s+(?:tx|transaction)|first\s+bet|fresh\s+wallet\b/i.test(normalized);
  }
  if (checkId === "slowNetworkAuthModal") {
    return /\bslow\s+network|timeout|delayed|latency\b/i.test(normalized) && /\bauth|modal|privy\b/i.test(normalized);
  }
  if (checkId === "slowNetworkChatAuth") {
    return /\bslow\s+network|timeout|delayed|latency\b/i.test(normalized) && /\bchat\s+auth|chat|message\b/i.test(normalized);
  }
  return /\b(?:wallet|privy|connect|disconnect|reconnect|wrong\s+network|mobile|clean\s+wallet|auth|transaction|tx)\b/i.test(normalized);
}
