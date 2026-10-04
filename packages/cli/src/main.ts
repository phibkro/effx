#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- effect/cli is the only CLI framework; registered in AGENTS.md */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { EmitMode, TargetProfile } from "@effx/compiler";
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

const selectedProject = Effect.fnUntraced(function* () {
  const flags = yield* root;

  return yield* resolveProject(
    Option.getOrElse(flags.project, () => "tsconfig.json"),
    Option.getOrUndefined(flags.strictAccess),
    Option.getOrUndefined(flags.target),
    Option.getOrUndefined(flags.emit),
    Option.getOrUndefined(flags.config),
    Option.getOrUndefined(flags.outDir),
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

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

BunRuntime.runMain(
  root.pipe(
    Command.withSubcommands([checkCli, buildCli, inspectCli, graphCli, surfaceCli]),
    Command.run({ version: versions.effx }),
    Effect.provide(Services),
  ),
);
