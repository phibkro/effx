/*
 * A unified diff of two texts (spec 0019 §4.1: source refactors are printed as a unified diff and applied by
 * nothing). Pure and total: Myers' O(ND) shortest edit script over lines, grouped into hunks with context.
 * The output is what `git apply` and `patch -p1` read.
 */

interface Line {
  readonly text: string;
  /** False only for the last line of a text that has no trailing newline. */
  readonly newline: boolean;
}

type Edit =
  | { readonly kind: "keep"; readonly before: number; readonly after: number }
  | { readonly kind: "delete"; readonly before: number }
  | { readonly kind: "insert"; readonly after: number };

const linesOf = (text: string): ReadonlyArray<Line> => {
  if (text === "") return [];

  const parts = text.split("\n");
  const trailing = parts[parts.length - 1] === "";
  const content = trailing ? parts.slice(0, -1) : parts;

  return content.map((line, index) => ({
    text: line,
    newline: trailing || index < content.length - 1,
  }));
};

const same = (left: Line, right: Line): boolean =>
  left.text === right.text && left.newline === right.newline;

/** Myers' greedy shortest edit script, recorded per edit distance so it can be walked back. */
const script = (before: ReadonlyArray<Line>, after: ReadonlyArray<Line>): ReadonlyArray<Edit> => {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  const offset = max;
  const frontier = new Int32Array(2 * max + 2);
  const history: Array<Int32Array> = [];

  const reach = (distance: number): boolean => {
    history.push(frontier.slice());

    for (let k = -distance; k <= distance; k += 2) {
      const down =
        k === -distance ||
        (k !== distance && (frontier[offset + k - 1] ?? 0) < (frontier[offset + k + 1] ?? 0));

      let x = down ? (frontier[offset + k + 1] ?? 0) : (frontier[offset + k - 1] ?? 0) + 1;
      let y = x - k;

      while (
        x < n &&
        y < m &&
        same(before[x] ?? { text: "", newline: true }, after[y] ?? { text: "", newline: false })
      ) {
        x += 1;
        y += 1;
      }

      frontier[offset + k] = x;

      if (x >= n && y >= m) return true;
    }

    return false;
  };

  let distance = 0;

  while (distance <= max && !reach(distance)) distance += 1;

  const edits: Array<Edit> = [];
  let x = n;
  let y = m;

  for (let d = distance; d > 0; d -= 1) {
    const previous = history[d] ?? frontier;
    const k = x - y;

    const down =
      k === -d || (k !== d && (previous[offset + k - 1] ?? 0) < (previous[offset + k + 1] ?? 0));

    const previousK = down ? k + 1 : k - 1;
    const previousX = previous[offset + previousK] ?? 0;
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      edits.push({ kind: "keep", before: x, after: y });
    }

    if (down) {
      y -= 1;
      edits.push({ kind: "insert", after: y });
    } else {
      x -= 1;
      edits.push({ kind: "delete", before: x });
    }
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    edits.push({ kind: "keep", before: x, after: y });
  }

  return edits.toReversed();
};

const marker = "\\ No newline at end of file";

const render = (prefix: string, line: Line): ReadonlyArray<string> =>
  line.newline ? [`${prefix}${line.text}`] : [`${prefix}${line.text}`, marker];

/** A unified diff of `before` to `after` for the file `path`, or the empty string when they are equal. */
export const unifiedDiff = (
  path: string,
  before: string,
  after: string,
  context: number = 3,
): string => {
  const left = linesOf(before);
  const right = linesOf(after);
  const edits = script(left, right);
  const changed = edits.flatMap((edit, index) => (edit.kind === "keep" ? [] : [index]));

  if (changed.length === 0) return "";

  // Groups of changes whose context windows touch or overlap become one hunk.
  const groups: Array<{ start: number; end: number }> = [];

  for (const index of changed) {
    const last = groups[groups.length - 1];

    if (last !== undefined && index - last.end <= 2 * context + 1) last.end = index;
    else groups.push({ start: index, end: index });
  }

  const hunks = groups.map(({ start, end }) => {
    const from = Math.max(0, start - context);
    const to = Math.min(edits.length - 1, end + context);
    const window = edits.slice(from, to + 1);

    const old = window.flatMap((edit) => (edit.kind === "insert" ? [] : [edit.before]));
    const next = window.flatMap((edit) => (edit.kind === "delete" ? [] : [edit.after]));

    const firstOld = old[0];
    const firstNew = next[0];

    const anchorOld =
      firstOld ?? edits.slice(0, from).filter((edit) => edit.kind !== "insert").length;

    const anchorNew =
      firstNew ?? edits.slice(0, from).filter((edit) => edit.kind !== "delete").length;

    const body = window.flatMap((edit): ReadonlyArray<string> => {
      if (edit.kind === "keep")
        return render(" ", left[edit.before] ?? { text: "", newline: true });

      return edit.kind === "delete"
        ? render("-", left[edit.before] ?? { text: "", newline: true })
        : render("+", right[edit.after] ?? { text: "", newline: true });
    });

    const header = `@@ -${old.length === 0 ? anchorOld : anchorOld + 1},${old.length} +${next.length === 0 ? anchorNew : anchorNew + 1},${next.length} @@`;

    return [header, ...body].join("\n");
  });

  return [`--- a/${path}`, `+++ b/${path}`, ...hunks].join("\n");
};
