#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- effect/cli is the only CLI framework; registered in AGENTS.md */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { DEFAULT_CEDAR_NAMESPACE, EmitMode, TargetProfile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { Console, Effect, Layer, Option, Stdio } from "effect";
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

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
  CedarWasm,
);

const command = root.pipe(
  Command.withSubcommands([
    checkCli,
    buildCli,
    inspectCli,
    graphCli,
    surfaceCli,
    cedarCli,
    explainCli,
  ]),
  Command.run({ version: versions.effx }),
);

BunRuntime.runMain(
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    const args = yield* stdio.args;

    // Select the output policy only; Command remains authoritative for parsing and validation.
    let explaining = false;

    for (let index = 0; index < args.length; index++) {
      const argument = args[index]!;

      if (["--project", "--config", "--out-dir", "--target", "--emit"].includes(argument)) {
        index++;
        continue;
      }

      if (argument.startsWith("-")) continue;

      explaining = argument === "explain";
      break;
    }

    if (!explaining) return yield* command;

    const explanationCommand = command.pipe(
      Effect.provideService(CliConfig.CliConfig, {
        builtIns: [GlobalFlag.Help, GlobalFlag.Version],
      }),
    );

    if (args.some((argument) => ["--help", "-h", "--version", "-v"].includes(argument))) {
      return yield* explanationCommand;
    }

    const console = yield* Console.Console;

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
  }).pipe(Effect.provide(Services)),
);
