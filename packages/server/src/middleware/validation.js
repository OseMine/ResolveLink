/**
 * Request Validation Middleware
 * Uses Zod schemas from @resolvelink/shared for runtime validation.
 */
const { createLogger } = require('../logger');

const log = createLogger('Validation');

/**
 * Create an Express middleware that validates req.body against a Zod schema.
 * @param {import('zod').ZodObject} schema - Zod schema to validate against
 * @param {string} [source='body'] - Which part of the request to validate ('body', 'query', 'params')
 * @returns {import('express').RequestHandler}
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    const result = schema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));

      log.warn(`Validation failed for ${req.method} ${req.path}:`, errors);

      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    // Replace with parsed/validated data (includes defaults)
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
