import { Predicate, type Schema } from "effect";

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * RFC 8785 (JCS) serialization of a JSON value: UTF-16 code-unit key order, no whitespace,
 * ES6 primitive formatting (`JSON.stringify` on a primitive is exactly that algorithm).
 */
export const canonicalJson = (json: Schema.Json): string => {
  if (
    Predicate.isNull(json) ||
    Predicate.isString(json) ||
    Predicate.isNumber(json) ||
    Predicate.isBoolean(json)
  ) {
    return JSON.stringify(json);
  }

  if (Predicate.isIterable(json)) {
    return `[${Array.from(json, canonicalJson).join(",")}]`;
  }

  const members = Object.keys(json)
    .toSorted(byCodeUnit)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(json[key] ?? null)}`);

  return `{${members.join(",")}}`;
};
