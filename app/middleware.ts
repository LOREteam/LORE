import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Simple rate limiting based on client identity
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // max requests per minute
const MAX_ENTRIES = 10000; // Maximum number of entries to prevent memory leak
let lastCleanupAt = 0;

function getRateLimitKey(request: NextRequest): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp;

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const ip = xForwardedFor.split(",")[0]?.trim();
    if (ip) return ip;
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  return `anon:${userAgent}`;
}

function cleanupOldEntries() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, value] of rateLimitMap.entries()) {
    // Remove entries that have expired
    if (now > value.resetAt) {
      rateLimitMap.delete(key);
      cleaned++;
    }
  }
  
  // If we still have too many entries, remove oldest ones
  if (rateLimitMap.size > MAX_ENTRIES) {
    const entries = Array.from(rateLimitMap.entries());
    entries.sort((a, b) => a[1].resetAt - b[1].resetAt);
    
    const toRemove = entries.slice(0, Math.floor(MAX_ENTRIES * 0.2)); // Remove oldest 20%
    for (const [key] of toRemove) {
      rateLimitMap.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[rate-limit] Cleaned ${cleaned} entries, ${rateLimitMap.size} remaining`);
  }
}

export function middleware(request: NextRequest) {
  // In development, never rate-limit: it breaks HMR/auth flows.
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const rateLimitPath = request.nextUrl.pathname;
  
  // Skip rate limiting for static files, public assets
  if (
    rateLimitPath.startsWith("/_next") ||
    rateLimitPath.startsWith("/static") ||
    rateLimitPath.endsWith(".png") ||
    rateLimitPath.endsWith(".jpg") ||
    rateLimitPath.endsWith(".jpeg") ||
    rateLimitPath.endsWith(".gif") ||
    rateLimitPath.endsWith(".webp") ||
    rateLimitPath.endsWith(".ico") ||
    rateLimitPath.endsWith(".svg") ||
    rateLimitPath.endsWith(".woff") ||
    rateLimitPath.endsWith(".woff2")
  ) {
    return NextResponse.next();
  }

  // Rate-limit only API routes to avoid UI/auth regressions.
  if (!rateLimitPath.startsWith("/api/")) {
    return NextResponse.next();
  }

  const key = getRateLimitKey(request);

  const now = Date.now();
  if (now - lastCleanupAt > RATE_LIMIT_WINDOW_MS) {
    cleanupOldEntries();
    lastCleanupAt = now;
  }
  const currentLimit = rateLimitMap.get(key);

  // Check if we need to reset the rate limit
  if (!currentLimit || now > currentLimit.resetAt) {
    rateLimitMap.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
  } else if (currentLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    // Rate limit exceeded
    return NextResponse.json(
      { error: "Too many requests", retryAfter: Math.ceil((currentLimit.resetAt - now) / 1000) },
      { status: 429 }
    );
  } else {
    // Increment counter
    currentLimit.count += 1;
    rateLimitMap.set(key, currentLimit);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|woff|woff2)$).*)",
  ],
};
