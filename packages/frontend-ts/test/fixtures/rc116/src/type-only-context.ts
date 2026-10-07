/**
 * A context module the generated clause may only reference from a type position.
 *
 * It throws while loading, so any value import of this module — in the original factory module or in
 * a generated wrapper — fails immediately instead of silently executing it.
 */
export const defaults = { maxBodyBytes: 128 };

throw new Error("type-only context must never be executed");
