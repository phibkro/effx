import { assert } from "@effect/vitest";
import type { SourceFile } from "./lift-source.ts";

/*
 * A reference applier for the unified diffs the compiler prints. It stands in for `git apply` in tests: every
 * context and removed line must match the text it is applied to, so a patch with a wrong offset fails loudly.
 */

/** The hunks of one file's diff applied to its text. */
export const applyHunks = (before: string, diff: string): string => {
  const lines = before.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  // A section split out of a multi-file patch ends with the newline that precedes the next header.
  const body = diff.endsWith("\n") ? diff.slice(0, -1).split("\n") : diff.split("\n");
  const hunks = body.flatMap((line, index) => (line.startsWith("@@") ? [index] : []));
  const output: Array<string> = [];
  let cursor = 0;

  for (const [position, start] of hunks.entries()) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/u.exec(body[start] ?? "");
    const oldStart = Number(header?.[1]);
    const oldCount = Number(header?.[2]);
    const first = oldCount === 0 ? oldStart : oldStart - 1;

    output.push(...lines.slice(cursor, first));
    cursor = first;

    const hunkEnd = hunks[position + 1] ?? body.length;

    for (let index = start + 1; index < hunkEnd; index += 1) {
      const line = body[index] ?? "";

      if (line.startsWith("\\")) continue;
      const text = line.slice(1) + (body[index + 1]?.startsWith("\\ No newline") ? "" : "\n");

      if (line.startsWith("+")) output.push(text);
      else {
        assert.strictEqual(
          lines[cursor],
          text,
          `a ${line.startsWith("-") ? "removed" : "context"} line matches the text`,
        );

        cursor += 1;

        if (line.startsWith(" ")) output.push(text);
      }
    }
  }

  output.push(...lines.slice(cursor));

  return output.join("");
};

/** A multi-file unified diff applied to files; a file the diff does not mention is unchanged. */
export const applyPatch = (
  files: ReadonlyArray<SourceFile>,
  patch: string,
): ReadonlyArray<SourceFile> => {
  const sections = new Map(
    patch
      .split(/^--- a\//mu)
      .slice(1)
      .map((section) => {
        const [path = "", ...rest] = section.split("\n");

        return [path, rest.join("\n")] as const;
      }),
  );

  return files.map((file) => {
    const diff = sections.get(file.path);

    return diff === undefined
      ? file
      : { path: file.path, contents: applyHunks(file.contents, diff) };
  });
};
