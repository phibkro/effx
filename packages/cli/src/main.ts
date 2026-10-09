/** @effect-diagnostics unstableApiUsage:off -- effect/cli is the only CLI framework; registered in AGENTS.md */
import { DEFAULT_CEDAR_NAMESPACE, EmitMode, TargetProfile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { Console, Effect, Layer, Logger, Option, Runtime, Schema, Stdio, Stream } from "effect";
import { Argument, CliConfig, Command, Flag, GlobalFlag } from "effect/cli";
import effectPackage from "effect/package.json";
import cliPackage from "../package.json";
import {
  type Versions,
  build,
  check,
  graphCommand,
  inspectCommand,
  resolveProject,
} from "./commands.ts";
import { cedarCommand } from "./cedar.ts";
import { CedarWasm } from "./cedar-validate.ts";
import { surfaceCheck } from "./surface.ts";
import { explain, explainUsage, ExplainFailed } from "./explain.ts";
import { lsp, type LspOptions } from "./lsp.ts";
import { dev } from "./watch.ts";

class CommandExit extends Schema.TaggedError<CommandExit>()("CommandExit", { code: Schema.Int }) {
  override readonly [Runtime.errorReported] = false;
  override get [Runtime.errorExitCode]() {
    return this.code;
  }
}

const versions: Versions = {
  effx: cliPackage.version,
  effect: effectPackage.version,
  typescript: TsSourceFrontend.typescriptVersion,
};

const root = Command.make("effx").pipe(
  Command.withSharedFlags({
    project: Flag.String("project").pipe(Flag.optional),
    config: Flag.String("config").pipe(Flag.optional),
    outDir: Flag.String("out-dir").pipe(Flag.optional),
    strictAccess: Flag.Boolean("strict-access").pipe(Flag.optional),
    target: Flag.Literals("target", TargetProfile.literals).pipe(Flag.optional),
    emit: Flag.Literals("emit", EmitMode.literals).pipe(Flag.optional),
  }),
  Command.withDescription("AOT application compiler for Effect"),
);

/**
 * `effx cedar` takes `--out-dir` as its own output directory and offers no access gate (spec 0017
 * §4), so it resolves the project without those two shared flags.
 */
const selectedProject = Effect.fnUntraced(function* (ownsOutDirAndAccessGate = false) {
  const flags = yield* root;

  return yield* resolveProject(
    Option.getOrElse(flags.project, () => "tsconfig.json"),
    ownsOutDirAndAccessGate ? undefined : Option.getOrUndefined(flags.strictAccess),
    Option.getOrUndefined(flags.target),
    Option.getOrUndefined(flags.emit),
    Option.getOrUndefined(flags.config),
    ownsOutDirAndAccessGate ? undefined : Option.getOrUndefined(flags.outDir),
    Option.isSome(flags.project),
  );
});

const explainCli = Command.make(
  "explain",
  { code: Argument.String("code") },
  Effect.fnUntraced(function* ({ code }) {
    const flags = yield* root;

    const unsupported = (
      [
        ["project", Option.isSome(flags.project)],
        ["out-dir", Option.isSome(flags.outDir)],
        ["strict-access", Option.isSome(flags.strictAccess)],
        ["target", Option.isSome(flags.target)],
        ["emit", Option.isSome(flags.emit)],
      ] as const
    ).find(([, supplied]) => supplied);

    if (unsupported !== undefined) {
      return yield* explainUsage(`Unsupported option for explain: --${unsupported[0]}`);
    }

    return yield* explain(code, Option.getOrUndefined(flags.config));
  }),
).pipe(
  Command.withDescription("Explain a diagnostic offline; --config opts into extension imports"),
);

const launchSelection = Effect.fnUntraced(function* () {
  const flags = yield* root;

  const selected: {
    -readonly [
      K in keyof Pick<
        LspOptions,
        "project" | "config" | "outDir" | "strictAccess" | "target" | "emit"
      >
    ]: LspOptions[K];
  } = {};

  if (Option.isSome(flags.project)) selected.project = flags.project.value;

  if (Option.isSome(flags.config)) selected.config = flags.config.value;

  if (Option.isSome(flags.outDir)) selected.outDir = flags.outDir.value;

  if (Option.isSome(flags.strictAccess)) selected.strictAccess = flags.strictAccess.value;

  if (Option.isSome(flags.target)) selected.target = flags.target.value;

  if (Option.isSome(flags.emit)) selected.emit = flags.emit.value;

  return selected;
});

const devCli = Command.make(
  "dev",
  {
    build: Flag.Boolean("build").pipe(Flag.withDefault(false)),
    executableFiles: Flag.String("exec-file").pipe(Flag.atLeast(0)),
    executableDirectories: Flag.String("exec-dir").pipe(Flag.atLeast(0)),
  },
  Effect.fnUntraced(function* (options) {
    const selected = yield* launchSelection();
    const stdio = yield* Stdio.Stdio;
    yield* Effect.raceFirst(
      dev({ ...selected, ...options, projectSelected: selected.project !== undefined }, versions),
      stdio.stdin.pipe(Stream.runDrain),
    );
  }),
).pipe(Command.withDescription("Watch diagnostics; --build explicitly opts into generated writes"));

const lspCli = Command.make(
  "lsp",
  {
    trustConfig: Flag.Boolean("trust-config").pipe(Flag.withDefault(false)),
    executableFiles: Flag.String("exec-file").pipe(Flag.atLeast(0)),
    executableDirectories: Flag.String("exec-dir").pipe(Flag.atLeast(0)),
  },
  Effect.fnUntraced(function* (options) {
    const selected = yield* launchSelection();
    const code = yield* lsp({ ...selected, ...options });

    if (code !== 0) return yield* new CommandExit({ code });
  }),
).pipe(Command.withDescription("Serve read-only editor diagnostics over LSP stdio"));

const checkCli = Command.make("check", {}, () => Effect.flatMap(selectedProject(), check)).pipe(
  Command.withDescription("Diagnose without writing"),
);

const buildCli = Command.make("build", {}, () =>
  Effect.flatMap(selectedProject(), (resolved) => build(resolved, versions)),
).pipe(Command.withDescription("Write selected projections (default: all)"));

const inspectCli = Command.make("inspect", { name: Argument.String("name") }, ({ name }) =>
  Effect.flatMap(selectedProject(), (resolved) => inspectCommand(resolved, name)),
).pipe(Command.withDescription("Show one operation's contract and exposures"));

const graphCli = Command.make(
  "graph",
  { name: Argument.String("name").pipe(Argument.optional) },
  ({ name }) => Effect.flatMap(selectedProject(), (resolved) => graphCommand(resolved, name)),
).pipe(Command.withDescription("Print a Mermaid graph, optionally from one node"));

const surfaceCheckCli = Command.make("check", { against: Flag.String("against") }, ({ against }) =>
  Effect.flatMap(selectedProject(), (resolved) => surfaceCheck(resolved, against)),
).pipe(
  Command.withDescription(
    "Verify an Alchemy Worker program wires exactly the generated handlers the surface requires",
  ),
);

const surfaceCli = Command.make("surface").pipe(
  Command.withSubcommands([surfaceCheckCli]),
  Command.withDescription("Surface manifest tools (spec 0021)"),
);

const cedarCli = Command.make(
  "cedar",
  {
    namespace: Flag.String("namespace").pipe(Flag.withDefault(DEFAULT_CEDAR_NAMESPACE)),
    policies: Flag.String("policies").pipe(Flag.atLeast(0)),
    denyWarnings: Flag.Boolean("deny-warnings").pipe(Flag.withDefault(false)),
  },
  ({ namespace, policies, denyWarnings }) =>
    Effect.gen(function* () {
      const flags = yield* root;
      const resolved = yield* selectedProject(true);

      return yield* cedarCommand(resolved, {
        namespace,
        policies,
        denyWarnings,
        outDir: Option.getOrUndefined(flags.outDir),
      });
    }),
).pipe(
  Command.withDescription(
    "Project capabilities and access contracts to a Cedar schema and policies, validated by Cedar (spec 0017)",
  ),
);

/** Portable compiler graph; the outside-packages process root supplies platform services. */
export const Services = Layer.mergeAll(TsSourceFrontend.layer, CedarWasm);

const command = root.pipe(
  Command.withSubcommands([
    checkCli,
    buildCli,
    devCli,
    lspCli,
    inspectCli,
    graphCli,
    surfaceCli,
    cedarCli,
    explainCli,
  ]),
  Command.run({ version: versions.effx }),
);

/** Suspended CLI program; the process root owns execution and native resource lifetimes. */
export const main = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const args = yield* stdio.args;

  // Select the output policy only; Command remains authoritative for parsing and validation.
  let explaining = false;
  let speakingLsp = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;

    if (
      [
        "--project",
        "--config",
        "--out-dir",
        "--target",
        "--emit",
        "--exec-file",
        "--exec-dir",
        "--log-level",
        "--completions",
      ].includes(argument)
    ) {
      index++;
      continue;
    }

    if (argument.startsWith("-")) continue;

    explaining = argument === "explain";
    speakingLsp = argument === "lsp";
    break;
  }

  if (!explaining && !speakingLsp) return yield* command;

  const explanationCommand = command.pipe(
    Effect.provideService(CliConfig.CliConfig, {
      builtIns: [GlobalFlag.Help, GlobalFlag.Version],
    }),
  );

  const console = yield* Console.Console;

  if (speakingLsp) {
    return yield* explanationCommand.pipe(
      Effect.provideService(Console.Console, {
        assert: console.assert.bind(console),
        clear: console.clear.bind(console),
        count: console.count.bind(console),
        countReset: console.countReset.bind(console),
        debug: console.error.bind(console),
        dir: console.dir.bind(console),
        dirxml: console.dirxml.bind(console),
        error: console.error.bind(console),
        group: console.group.bind(console),
        groupCollapsed: console.groupCollapsed.bind(console),
        groupEnd: console.groupEnd.bind(console),
        info: console.error.bind(console),
        log: console.error.bind(console),
        table: console.table.bind(console),
        time: console.time.bind(console),
        timeEnd: console.timeEnd.bind(console),
        timeLog: console.timeLog.bind(console),
        trace: console.trace.bind(console),
        warn: console.warn.bind(console),
      }),
      Effect.provideService(Logger.LogToStderr, true),
    );
  }

  if (args.some((argument) => ["--help", "-h", "--version", "-v"].includes(argument))) {
    return yield* explanationCommand;
  }

  // Native CLI parse failures always print help via log. Explain requires usage on stderr.
  return yield* explanationCommand.pipe(
    Effect.catchTag("ShowHelp", () => Effect.fail(new ExplainFailed({ exitCode: 2 }))),
    Effect.provideService(Console.Console, {
      assert: console.assert.bind(console),
      clear: console.clear.bind(console),
      count: console.count.bind(console),
      countReset: console.countReset.bind(console),
      debug: console.debug.bind(console),
      dir: console.dir.bind(console),
      dirxml: console.dirxml.bind(console),
      error: console.error.bind(console),
      group: console.group.bind(console),
      groupCollapsed: console.groupCollapsed.bind(console),
      groupEnd: console.groupEnd.bind(console),
      info: console.info.bind(console),
      log: console.error.bind(console),
      table: console.table.bind(console),
      time: console.time.bind(console),
      timeEnd: console.timeEnd.bind(console),
      timeLog: console.timeLog.bind(console),
      trace: console.trace.bind(console),
      warn: console.warn.bind(console),
    }),
  );
}).pipe(Effect.provideService(Logger.LogToStderr, true));
