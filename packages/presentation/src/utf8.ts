/**
 * The UTF-8 byte counter for the T5 modules.
 *
 * In jam-flow, `rich-content.ts`, `agent-plan.ts` and `session-information.ts`
 * measured with `utf8Bytes` from the host limits module, which wraps Node's
 * `Buffer.byteLength`. This package must run in a browser, so it measures with
 * `TextEncoder`, as `json-value.ts` and `messages.ts` already do. Both count a
 * lone surrogate as the three bytes of U+FFFD, so every count is unchanged.
 *
 * Internal: `index.ts` does not export it.
 */

/** One shared encoder: `TextEncoder` is stateless, and every byte count must agree. */
const encoder = new TextEncoder();

/**
 * Byte length of a string as UTF-8, which is what every limit here measures.
 * `String.length` counts UTF-16 units and would under-count every non-ASCII payload.
 */
export const utf8Bytes = (value: string): number =>
  encoder.encode(value).byteLength;
