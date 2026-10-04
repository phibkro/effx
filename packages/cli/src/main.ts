#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- effect/cli is the only CLI framework; registered in AGENTS.md */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { DEFAULT_CEDAR_NAMESPACE, EmitMode, TargetProfile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { Effect, Layer, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
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

BunRuntime.runMain(
  root.pipe(
    Command.withSubcommands([checkCli, buildCli, inspectCli, graphCli, surfaceCli, cedarCli]),
    Command.run({ version: versions.effx }),
    Effect.provide(Services),
  ),
);
