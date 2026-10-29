/**
 * Shared output rendering for every `hithink_*` tool.
 *
 * One place decides how a structured result reaches the model, so the "never
 * dump a whole table into context" rule cannot drift per tool.
 */

/**
 * Render a JSON-ish result as a single text block.
 *
 * @param {unknown} value
 * @returns {{ type: 'text', text: string }[]}
 */
export function renderJson(value) {
  let text;
  try {
    text = JSON.stringify(value, null, 1);
  } catch (error) {
    text = JSON.stringify({ error: { category: 'INTERNAL', message: String(error?.message ?? error) } });
  }
  return [{ type: 'text', text }];
}

/**
 * Schema for a tool that returns one free-form JSON object. DSH uses the schema
 * for validation only; `render` decides the wire form.
 */
export const OBJECT_OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => renderJson(value),
};

/**
 * Convert an Error into the flat, model-readable error object every tool throws
 * as a value (never as an exception, which would become an opaque tool fault).
 *
 * @param {{ category: string, message: string, hint?: string, retryable?: boolean,
 *           requestId?: string, detail?: unknown }} shape
 */
export function errorResult(shape) {
  const result = {
    ok: false,
    error: {
      category: shape.category,
      message: shape.message,
      retryable: shape.retryable === true,
    },
  };
  if (shape.hint) result.error.hint = shape.hint;
  if (shape.requestId) result.error.requestId = shape.requestId;
  if (shape.detail !== undefined) result.error.detail = shape.detail;
  return result;
}
