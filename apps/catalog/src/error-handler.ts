import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

/**
 * App-wide error handler (mirrors apps/api/src/lib/error-handler.ts): every
 * failure leaves as the documented `{error}` (ApiErrorSchema) shape. Zod
 * validation failures become 400s with a safe field-level message; deliberate
 * HTTP errors (rate limit, malformed JSON) keep their safe message; anything
 * else is logged in full and leaves as an opaque 500 — raw driver/ORM messages
 * never reach clients.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const detail = error.validation
      .map((issue) => `${issue.instancePath || '(request)'} ${issue.message ?? 'is invalid'}`)
      .join('; ');
    void reply.status(400).send({ error: `validation failed: ${detail}` });
    return;
  }

  if (isResponseSerializationError(error)) {
    request.log.error({ err: error }, 'response failed schema serialization');
    void reply.status(500).send({ error: 'Internal server error' });
    return;
  }

  const statusCode = error.statusCode ?? 500;
  if (statusCode < 500) {
    void reply.status(statusCode).send({ error: error.message });
    return;
  }

  request.log.error({ err: error }, 'unhandled error');
  void reply.status(500).send({ error: 'Internal server error' });
}
