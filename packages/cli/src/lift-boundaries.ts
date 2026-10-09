import { Context, Effect } from "effect";
import { CompilerFault } from "@effx/compiler";

/*
 * The check's native-execution boundary (spec 0019 §2.4): portable CLI orchestration describes a child,
 * and the scripts/effx.ts root supplies the one actual ChildProcessSpawner capability. The receipt reports
 * only observations: bounded stdout/stderr prefixes, truncation flags, actual elapsed time and the exit facts
 * the installed process API exposes. The boundary carries no arbitrary environment and makes no sandbox claim.
 */

/** One real child execution the check needs, with every input explicit and immutable. */
export interface CheckChildSpec {
  /** Absolute path of the executable supplied by the root-owned toolchain configuration. */
  readonly binary: string;
  /** Absolute working directory owned by this child. */
  readonly cwd: string;
  /** Explicit non-secret arguments; application environments and ambient credentials are never copied. */
  readonly args: ReadonlyArray<string>;
  /** Per-pipe byte cap; the root continues draining after this prefix and reports truncation. */
  readonly captureBytes: number;
  /** Forced-stop deadline in milliseconds. */
  readonly forcedStopMs: number;
}

/** The exit facts available from Effect's native process handle. */
export type CheckChildExit =
  | { readonly _tag: "Exit"; readonly code: number }
  | {
      readonly _tag: "Stopped";
      readonly reason: "deadline" | "signal";
      /** The installed handle reports signal death as an exit error without the signal field. */
      readonly signal: "unknown";
      /** Present only when a real numeric exit code was observed during a deadline stop. */
      readonly exitCode?: number;
    };

/** One executed child's observed receipt, with bounded capture metadata and no synthetic zero values. */
export interface CheckChildResult {
  readonly exit: CheckChildExit;
  readonly stdout: string;
  readonly stderr: string;
  readonly stderrLines: ReadonlyArray<string>;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
  /** True only when the forced-stop deadline actually won the completion race. */
  readonly timedOut: boolean;
}

/** The overlay-wide typecheck the binding gate needs (spec 0019 §7). */
export interface OverlayTypecheckSpec {
  /** Absolute path of the TypeScript entry the root adapter runs. */
  readonly tscPath: string;
  /** Program arguments (the tsc project path and flag-style switches). */
  readonly args: ReadonlyArray<string>;
  /** Absolute working directory of the overlay. */
  readonly cwd: string;
  /** Per-pipe byte cap; overflow remains a typed data fact. */
  readonly captureBytes: number;
  /** Forced-stop deadline the root adapter grants. */
  readonly forcedStopMs: number;
}

/** The real typecheck receipt: each pipe stays separate; callers render summaries, never raw source lines. */
export interface OverlayTypecheckResult {
  readonly exit: CheckChildExit;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutLines: ReadonlyArray<string>;
  readonly stderrLines: ReadonlyArray<string>;
  readonly output: ReadonlyArray<string>;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

/**
 * The native-execution seam. Implementations live at the composition root only; package code resolves the
 * service through a Layer the root provides, never through its own process authority.
 */
export class LiftCheckExecution extends Context.Service<
  LiftCheckExecution,
  {
    /** Run one check child with the exact spec; process failures stay typed. */
    readonly runChild: (
      spec: CheckChildSpec,
    ) => Effect.Effect<CheckChildResult, CompilerFault, never>;
    /** Run the binding typecheck; only a real execution receipt can prove binding. */
    readonly runTypecheck: (
      spec: OverlayTypecheckSpec,
    ) => Effect.Effect<OverlayTypecheckResult, CompilerFault, never>;
  }
>()("effx/cli/LiftCheckExecution") {}
