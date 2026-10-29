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
    text = JSON.stringify({
      ok: false,
      error: { category: 'INTERNAL', message: String(error?.message ?? error) },
    });
  }
  return [{ type: 'text', text }];
}

/**
 * Build a fresh output descriptor for one tool registration.
 *
 * A factory rather than a shared constant: the host owns the descriptor it is
 * given and may annotate it, so two tools must never share one object.
 *
 * @returns {{ schema: object, render: (args: unknown, value: unknown) => { type: string, text: string }[] }}
 */
export function objectOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => renderJson(value),
  };
}
