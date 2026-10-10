import { CompilerFault } from "@effx/compiler";
import { Effect, Stdio, Stream } from "effect";

/*
 * The one way a command prints. Every report, summary, patch, graph and explanation is written through the
 * process root's `Stdio` service, never through the global console: the console does not retry on a
 * non-blocking descriptor, so a report larger than the pipe or socket buffer reached a slow reader as a
 * prefix (observed: `effx lift --json` cut at 262,144 of 288,877 bytes, exit code 1; traced as
 * `write(1, ..., 26741) = -1 EAGAIN` and then `exit_group(1)`). The Stdio sink waits for `drain` whenever the
 * stream refuses a write, so a command returns only after the stream accepted every byte it printed.
 */

/** The standard stream a command writes to. */
export type StandardStream = "stdout" | "stderr";

/**
 * Writes `lines` to `stream`, each ended by a newline, as one write. Nothing is written for no lines. A
 * stream that cannot be written is an IO fault of the command, never a diagnostic.
 */
export const printLines = (
  stream: StandardStream,
  lines: ReadonlyArray<string>,
): Effect.Effect<void, CompilerFault, Stdio.Stdio> =>
  lines.length === 0
    ? Effect.void
    : Effect.flatMap(Stdio.Stdio, (stdio) =>
        Stream.make(`${lines.join("\n")}\n`).pipe(
          Stream.run(
            stream === "stdout"
              ? stdio.stdout({ endOnDone: false })
              : stdio.stderr({ endOnDone: false }),
          ),
        ),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new CompilerFault({ stage: "output", message: `cannot write to ${stream}`, cause }),
        ),
      );

/** One line on standard output. */
export const printOut = (text: string) => printLines("stdout", [text]);

/** One line on standard error. */
export const printErr = (text: string) => printLines("stderr", [text]);
