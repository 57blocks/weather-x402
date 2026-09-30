import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public details?: unknown,
  ) {
    super(message);
  }
}

interface BodyParserError extends Error {
  status?: number;
  type?: string;
  body?: string;
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError('INVALID_INPUT', 'Request validation failed', 400, error.flatten());
  }

  const parserError = error as BodyParserError;
  if (parserError?.status === 400 && parserError.type === 'entity.parse.failed') {
    if (typeof parserError.body === 'string') {
      try {
        JSON.parse(parserError.body);
        return new AppError('INVALID_INPUT', 'Request body must be a JSON object', 400);
      } catch {
        // Fall through: the body is malformed JSON rather than a valid primitive.
      }
    }
    return new AppError('INVALID_JSON', 'Request body must contain valid JSON', 400);
  }
  if (parserError?.status === 413) {
    return new AppError('BODY_TOO_LARGE', 'Request body is too large', 413);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new AppError('UPSTREAM_TIMEOUT', 'Upstream provider timed out', 504);
  }
  return new AppError('INTERNAL_ERROR', 'The service could not complete the request', 500);
}
