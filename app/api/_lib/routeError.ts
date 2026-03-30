type RouteErrorDetails = {
  name: string;
  message: string;
};

export function describeRouteError(error: unknown): RouteErrorDetails {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Unknown error",
    };
  }

  if (typeof error === "string" && error.trim()) {
    return {
      name: "Error",
      message: error,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

export function logRouteError(route: string, error: unknown, extra?: Record<string, unknown>) {
  const details = describeRouteError(error);
  if (extra && Object.keys(extra).length > 0) {
    console.error(`[${route}] ${details.name}: ${details.message}`, extra);
    return;
  }
  console.error(`[${route}] ${details.name}: ${details.message}`);
}
