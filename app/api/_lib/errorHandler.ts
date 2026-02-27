import { NextResponse } from "next/server";

/**
 * Standardized error response for API routes
 */
export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Handle API errors with consistent logging and response format
 */
export function handleApiError(
  error: unknown,
  context: string,
  statusCode: number = 500
): NextResponse<ApiError> {
  const message = error instanceof Error ? error.message : String(error);
  
  // Log the error with context
  console.error(`[${context}] Error:`, message);
  
  // Return standardized error response
  return NextResponse.json(
    { 
      error: message,
      code: context,
    },
    { status: statusCode }
  );
}

/**
 * Wrap async route handlers with centralized error handling
 */
export function withErrorHandling(
  handler: (request: Request) => Promise<NextResponse>,
  context: string
) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      return handleApiError(error, context);
    }
  };
}

/**
 * Validate required parameters from request
 */
export function validateRequiredParams(
  params: Record<string, string | null>,
  required: string[]
): { valid: boolean; missing?: string } {
  for (const param of required) {
    if (!params[param]) {
      return { valid: false, missing: param };
    }
  }
  return { valid: true };
}
