import { Data, Result, type Schema } from "effect";

const strictJsonDecoder = new TextDecoder("utf-8", { fatal: true });

/** A request body that is not UTF-8 JSON, or whose object names one member twice. */
export class MalformedJson extends Data.TaggedError("MalformedJson") {}

/** Whether an object of a JSON text names one member twice; a malformed member name throws. */
const repeatsMemberName = (text: string): boolean => {
  const stack: Array<{
    readonly kind: "array" | "object";
    readonly keys?: Set<string>;
    expectKey: boolean;
  }> = [];

  let index = 0;
  let expectingKey = false;

  while (index < text.length) {
    const char = text[index]!;

    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (char === "{") {
      stack.push({ kind: "object", keys: new Set(), expectKey: true });
      expectingKey = true;
      index += 1;
      continue;
    }

    if (char === "[") {
      stack.push({ kind: "array", expectKey: false });
      expectingKey = false;
      index += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      stack.pop();
      expectingKey = stack.at(-1)?.kind === "object" && stack.at(-1)?.expectKey === true;
      index += 1;
      continue;
    }

    if (char === ",") {
      const top = stack.at(-1);

      if (top?.kind === "object") top.expectKey = true;
      expectingKey = top?.kind === "object";
      index += 1;
      continue;
    }

    if (char === ":") {
      const top = stack.at(-1);

      if (top?.kind === "object") top.expectKey = false;
      expectingKey = false;
      index += 1;
      continue;
    }

    if (char === '"') {
      const start = index;
      index += 1;

      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }

        if (text[index] === '"') {
          index += 1;
          break;
        }

        index += 1;
      }

      if (expectingKey) {
        const key: string = JSON.parse(text.slice(start, index));
        const keys = stack.at(-1)?.keys;

        if (keys?.has(key) === true) return true;
        keys?.add(key);
      }

      continue;
    }

    index += 1;
  }

  return false;
};

/** Decodes UTF-8 JSON while rejecting duplicate object member names. */
export const parseJsonWithUniqueMembers = (
  bytes: Uint8Array,
): Result.Result<Schema.Json, MalformedJson> =>
  Result.gen(function* () {
    const malformed = () => new MalformedJson();

    const text = yield* Result.try({
      try: () => strictJsonDecoder.decode(bytes),
      catch: malformed,
    });

    const repeated = yield* Result.try({ try: () => repeatsMemberName(text), catch: malformed });

    if (repeated) return yield* Result.fail(malformed());

    return yield* Result.try({ try: (): Schema.Json => JSON.parse(text), catch: malformed });
  });
