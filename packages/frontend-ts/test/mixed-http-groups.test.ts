import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { Extensions, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { ts, tryTs } from "../src/ts.ts";

const repository = new URL("../../../", import.meta.url).pathname;

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

const versions = [
  {
    version: "4.0.0",
    dependencies: new URL("../../../node_modules", import.meta.url).pathname,
    api: "effect/http-api",
    http: "effect/http",
  },
] as const;

type Target = (typeof versions)[number];

const rootSource = ({ api }: Target) => `
import { Context, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "${api}";
export class Denied extends Schema.TaggedError<Denied>()("Denied", {}) {}
export class StartupError extends Schema.TaggedError<StartupError>()("StartupError", {}) {}
export class WrongError extends Schema.TaggedError<WrongError>()("WrongError", {}) {}
export class ReadService extends Context.Service<ReadService, { readonly value: string }>()("mixed/ReadService") {}
export class CommandService extends Context.Service<CommandService, { readonly value: string }>()("mixed/CommandService") {}
export class ReadGuard extends Context.Service<ReadGuard, { readonly value: string }>()("mixed/ReadGuard") {}
export class CommandGuard extends Context.Service<CommandGuard, { readonly value: string }>()("mixed/CommandGuard") {}
export class ManualService extends Context.Service<ManualService, { readonly value: string }>()("mixed/ManualService") {}
export class StartupService extends Context.Service<StartupService, { readonly value: string }>()("mixed/StartupService") {}
export const ReadInput = Schema.Struct({ boardId: Schema.String });
export const CommandInput = Schema.Struct({ message: Schema.String });
export const Root = HttpApi.make("application").add(
  HttpApiGroup.make("onboarding").add(
    HttpApiEndpoint.get("readBoard", "/board", { query: ReadInput.fields, success: Schema.String, error: Denied }),
    HttpApiEndpoint.post("command", "/command", { payload: CommandInput, success: Schema.String, error: Denied }),
    HttpApiEndpoint.post("claim", "/claim/:boardId", {
      params: { boardId: Schema.String }, payload: Schema.Struct({ count: Schema.Number }),
      success: Schema.String, error: Denied,
    }),
  ),
);
`;

const declarations = `
import { Schema } from "effect";
import { Http, Operation } from "@effx/runtime";
import { Root, ReadInput, CommandInput, Denied } from "./root.ts";
export const Onboarding = Http.group({ root: Root, group: "onboarding" });
export const readBoard = Operation.query({ name: "readBoard", input: ReadInput, success: Schema.String })
  .in(Onboarding).http.get("/board").http.contract({ query: ReadInput, metadata: { operationId: "onboarding.readBoard" } }).errors(Denied).declare();
export const command = Operation.command({ name: "command", input: CommandInput, success: Schema.String })
  .in(Onboarding).http.post("/command").http.contract({ payload: CommandInput, metadata: { operationId: "onboarding.command" } }).errors(Denied).declare();
`;

const bindingsSource = ({ http }: Target) => `
import { Effect } from "effect";
import { HttpServerResponse } from "${http}";
import { OnboardingApiHandlers } from "./.effx/generated/onboarding-handlers.ts";
import { ReadService, CommandService, ReadGuard, CommandGuard, ManualService, Denied } from "./root.ts";
export const guards = {
  "onboarding.readBoard": Effect.fnUntraced(function* () { return (yield* ReadGuard).value; }),
  "onboarding.command": Effect.fnUntraced(function* () { return (yield* CommandGuard).value; }),
};
export const raw = {
  readBoard: Effect.fnUntraced(function* (_input: unknown, authorize: () => Effect.Effect<string, never, ReadGuard>) {
    yield* authorize();
    return HttpServerResponse.text((yield* ReadService).value);
  }),
  command: Effect.fnUntraced(function* (_input: unknown, authorize: () => Effect.Effect<string, never, CommandGuard>) {
    yield* authorize();
    return HttpServerResponse.text((yield* CommandService).value);
  }),
};
export const complete = OnboardingApiHandlers({ raw, guards });
export const manual = Effect.fnUntraced(function* (input: { readonly params: { readonly boardId: string }; readonly payload: { readonly count: number } }) {
  if (input.payload.count < 0) return yield* new Denied();
  return (yield* ManualService).value + input.params.boardId + input.payload.count;
});
`;

const positiveSource = ({ api, http }: Target) => `
import { Effect } from "effect";
import type { Layer, Scope } from "effect";
import type { HttpApiGroup } from "${api}";
import type { HttpRouter } from "${http}";
import type { OnboardingApiHandlers, OnboardingGuards, OnboardingRawHandlers } from "./.effx/generated/onboarding-handlers.ts";
import type { Root, ReadService, CommandService, ReadGuard, CommandGuard, ManualService } from "./root.ts";
import { StartupService, StartupError } from "./root.ts";
import { complete, guards, raw, manual } from "./bindings.ts";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Endpoints = HttpApiGroup.Endpoints<(typeof Root)["groups"]["onboarding"]>;
type RawKeys = Assert<Equal<keyof OnboardingRawHandlers<Endpoints, typeof guards>, "readBoard" | "command">>;
type GuardKeys = Assert<Equal<keyof OnboardingGuards<Endpoints>, "onboarding.readBoard" | "onboarding.command">>;
const sync = complete((handlers) => {
  type Native = Assert<Equal<typeof handlers["~HandledIdentifiers"], "readBoard" | "command">>;
  type AllKeys = Assert<Equal<keyof typeof handlers["~EndpointsByIdentifier"], "readBoard" | "command" | "claim">>;
  return handlers.handle("claim", manual);
});
const startup = complete(Effect.fnUntraced(function* (handlers) {
  yield* Effect.scope;
  if ((yield* StartupService).value === "") return yield* new StartupError();
  return handlers.handle("claim", manual);
}));
type RequestServices = HttpRouter.Request.From<"Requires", ReadService | CommandService | ReadGuard | CommandGuard | ManualService>;
type SyncServices = Assert<Equal<Layer.Services<typeof sync>, RequestServices>>;
type SyncError = Assert<Equal<Layer.Error<typeof sync>, never>>;
type SyncSuccess = Assert<Equal<Layer.Success<typeof sync>, HttpApiGroup.Service<"application", "onboarding">>>;
type StartupServices = Assert<Equal<Layer.Services<typeof startup>, RequestServices | StartupService>>;
type StartupFailure = Assert<Equal<Layer.Error<typeof startup>, StartupError>>;
type StartupSuccess = Assert<Equal<Layer.Success<typeof startup>, Layer.Success<typeof sync>>>;
type NoScope = Assert<Equal<Extract<Layer.Services<typeof startup>, Scope.Scope>, never>>;
declare const factory: typeof OnboardingApiHandlers;
const independent = factory({ raw, guards })(handlers => handlers.handle("claim", manual));
type ImportedFactoryServices = Assert<Equal<Layer.Services<typeof independent>, Layer.Services<typeof sync>>>;
type ImportedFactorySuccess = Assert<Equal<Layer.Success<typeof independent>, Layer.Success<typeof sync>>>;
type ImportedFactoryError = Assert<Equal<Layer.Error<typeof independent>, never>>;
`;

// Each separate program must fail at its own use site, not in the generated module.
const negativeCases = [
  ["missing-claim", "complete(handlers => handlers);"],
  [
    "duplicate-claim",
    'complete(handlers => handlers.handle("claim", manual).handle("claim", manual));',
  ],
  [
    "already-read",
    'complete(handlers => handlers.handle("readBoard", () => Effect.succeed("bad")).handle("claim", manual));',
  ],
  [
    "already-command",
    'complete(handlers => handlers.handleRaw("command", () => Effect.succeed(HttpServerResponse.text("bad"))).handle("claim", manual));',
  ],
  [
    "wrong-request",
    'complete(handlers => handlers.handle("claim", (input: { readonly payload: { readonly count: string } }) => Effect.succeed(input.payload.count)));',
  ],
  [
    "wrong-error",
    'complete(handlers => handlers.handle("claim", () => Effect.fail(new WrongError())));',
  ],
  [
    "raw-error",
    'OnboardingApiHandlers({ guards, raw: { ...raw, readBoard: () => Effect.fail(new WrongError()) } })(handlers => handlers.handle("claim", manual));',
  ],
  [
    "raw-claim-key",
    'OnboardingApiHandlers({ guards, raw: { ...raw, claim: () => Effect.succeed(HttpServerResponse.text("bad")) } })(handlers => handlers.handle("claim", manual));',
  ],
  [
    "guard-claim-key",
    'OnboardingApiHandlers({ raw, guards: { ...guards, "onboarding.claim": () => Effect.void } })(handlers => handlers.handle("claim", manual));',
  ],
] as const;

const diagnostics = Effect.fnUntraced(function* (
  options: ts.CompilerOptions,
  roots: ReadonlyArray<string>,
) {
  return yield* tryTs("mixed-http-group-acceptance", () => {
    const program = ts.createProgram([...roots], options);

    return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
      file: diagnostic.file?.fileName,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
  });
});

describe("mixed-ownership HTTP group completion", () => {
  for (const target of versions) {
    it.effect(
      `preserves native completion validation and channels on Effect ${target.version}`,
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped();
          yield* fs.symlink(target.dependencies, path.join(directory, "node_modules"));

          const config = {
            compilerOptions: {
              target: "ES2023",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              allowImportingTsExtensions: true,
              types: [],
              resolveJsonModule: true,
              paths: {
                "@effx/runtime": [path.join(repository, "packages/runtime/src/index.ts")],
                "@effx/diagnostics": [path.join(repository, "packages/diagnostics/src/index.ts")],
                "@effx/runtime/diagnostics": [
                  path.join(repository, "packages/runtime/src/diagnostics.ts"),
                ],
                effect: [path.join(target.dependencies, "effect/dist/index.d.ts")],
                "effect/package.json": [path.join(target.dependencies, "effect/package.json")],
                "effect/*": [path.join(target.dependencies, "effect/dist/*.d.ts")],
              },
            },
            include: ["declarations.ts"],
          };

          const configText = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(config);
          const tsconfigPath = path.join(directory, "tsconfig.json");
          yield* fs.writeFileString(tsconfigPath, configText);
          yield* fs.writeFileString(path.join(directory, "root.ts"), rootSource(target));
          yield* fs.writeFileString(path.join(directory, "declarations.ts"), declarations);

          const result = yield* compile(
            { tsconfigPath, entry: ["declarations.ts"], emit: "handlers" },
            Extensions.builtin,
          );

          assert.deepStrictEqual(
            result.diagnostics.filter((item) => item.severity === "error"),
            [],
          );
          const files = Option.getOrThrow(result.files.value);
          assert.deepStrictEqual(
            files.map((file) => file.path),
            ["onboarding-handlers.ts"],
          );
          const generatedDirectory = path.join(directory, ".effx/generated");
          yield* fs.makeDirectory(generatedDirectory, { recursive: true });

          for (const file of files)
            yield* fs.writeFileString(path.join(generatedDirectory, file.path), file.contents);
          yield* fs.writeFileString(path.join(directory, "bindings.ts"), bindingsSource(target));
          const positive = path.join(directory, "positive.ts");
          yield* fs.writeFileString(positive, positiveSource(target));
          const typeOnly = path.join(directory, "type-only.ts");
          yield* fs.writeFileString(
            typeOnly,
            `import type { OnboardingApiHandlers, OnboardingGuards, OnboardingRawHandlers } from "./.effx/generated/onboarding-handlers.ts";
import type { HttpApiGroup } from "${target.api}";
import type { Root } from "./root.ts";
type Endpoints = HttpApiGroup.Endpoints<(typeof Root)["groups"]["onboarding"]>;
export type Factory = typeof OnboardingApiHandlers;
export type Guards = OnboardingGuards<Endpoints>;
export type Raw = OnboardingRawHandlers<Endpoints, Guards>;
`,
          );

          const parsed = yield* tryTs("mixed-http-group-config", () => {
            const json = ts.parseConfigFileTextToJson(tsconfigPath, configText);

            return ts.parseJsonConfigFileContent(json.config, ts.sys, directory);
          });

          assert.deepStrictEqual(parsed.errors, []);
          assert.deepStrictEqual(yield* diagnostics(parsed.options, [typeOnly]), []);
          assert.deepStrictEqual(yield* diagnostics(parsed.options, [positive]), []);
          const negativeRoots: Array<string> = [];

          for (const [name, expression] of negativeCases) {
            const filename = path.join(directory, `${name}.ts`);
            negativeRoots.push(filename);
            yield* fs.writeFileString(
              filename,
              `
import { Effect } from "effect";
import { HttpServerResponse } from "${target.http}";
import { OnboardingApiHandlers } from "./.effx/generated/onboarding-handlers.ts";
import { WrongError } from "./root.ts";
import { complete, manual, raw, guards } from "./bindings.ts";
${expression}
`,
            );
          }

          const errors = yield* diagnostics(parsed.options, negativeRoots);
          assert.deepStrictEqual(
            errors.filter((error) => !negativeRoots.includes(error.file ?? "")),
            [],
          );

          for (const filename of negativeRoots) {
            assert.isTrue(
              errors.some((error) => error.file === filename),
              `${path.basename(filename)} must be rejected`,
            );
          }
        }).pipe(Effect.provide(Services)),
      120_000,
    );
  }
});
