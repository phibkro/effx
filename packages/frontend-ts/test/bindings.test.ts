import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { compile, Extensions } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";
import { copyUsersFixture } from "../../../tools/testing/projects.ts";
import { ts, tryTs } from "../src/ts.ts";

const Services = Layer.mergeAll(
  BunServices.layer,
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
);

const declarations = `
import { Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Http, Operation } from "@effx/runtime";
export const Success = Schema.String;
export const Input = Schema.Void;
export const Api = HttpApi.make("binding")
  .add(HttpApiGroup.make("binding").add(
    HttpApiEndpoint.get("read", "/binding", { success: Success }),
    HttpApiEndpoint.get("native", "/native", { success: Success }),
  ))
  .add(HttpApiGroup.make("local").add(HttpApiEndpoint.get("read", "/local", { success: Success })));
export const Group = Http.group({ root: Api, group: "binding" });
export const read = Operation.query({ name: "binding.read", input: Input, success: Success })
  .in(Group)
  .http.get("/binding")
  .http.contract({ root: "binding", group: "binding", success: Success, metadata: { operationId: "binding.read" } })
  .declare();
export const LocalGroup = Http.group({ root: Api, group: "local" });
export const local = Operation.query({ name: "local.read", input: Input, success: Success })
  .in(LocalGroup)
  .http.get("/local")
  .http.contract({ root: "binding", group: "local", success: Success, metadata: { operationId: "local.read" } })
  .handler(() => Effect.succeed("local"));
export const EmptyGroup = Http.group({ root: Api, group: "empty" });
`;

const backend = `
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
export function handlers(prefix: string) { return { read: () => Effect.succeed(HttpServerResponse.text(prefix)) }; }
export const guards = (prefix: string) => ({ "binding.read": () => Effect.succeed(prefix) });
export const guardFor = (_endpoint: unknown) => () => Effect.void;
export const notFunction = 1;
const hidden = () => ({});
// Importing this module would throw. Static collection must never execute it.
throw new Error("backend evaluated");
`;

const bindingSource = (binding: string) => `
import { Binding as B } from "@effx/runtime";
import { Group as ImportedGroup, LocalGroup, EmptyGroup, Success } from "./_binding-declarations.ts";
import { handlers, guards, guardFor, notFunction } from "./_binding-backend.ts";
${binding}
`;

const fixture = Effect.fnUntraced(function* (binding: string) {
  const directory = yield* copyUsersFixture();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const [file, text] of [
    ["_binding-declarations.ts", declarations],
    ["_binding-backend.ts", backend],
    ["_binding.bind.ts", bindingSource(binding)],
  ] as const)
    yield* fs.writeFileString(path.join(directory, "src", file), text);

  return { directory, config: path.join(directory, "tsconfig.json") };
});

const run = (config: string, emit: "contract" | "handlers", bound = true) =>
  compile(
    {
      tsconfigPath: config,
      entry: ["src/_binding-declarations.ts", ...(bound ? ["src/_binding.bind.ts"] : [])],
      emit,
    },
    Extensions.builtin,
  );

const errors = (result: { readonly diagnostics: ReadonlyArray<{ readonly severity: string }> }) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("static backend group bindings", () => {
  it.effect(
    "keeps contract/IR/hash identical, leaves unbound bytes intact and retains native completion",
    () =>
      Effect.gen(function* () {
        const { config } = yield* fixture(
          "export const Bound = B.group(ImportedGroup, { handlers, guards });",
        );

        const plainContract = yield* run(config, "contract", false);
        const contract = yield* run(config, "contract");
        const plainHandlers = yield* run(config, "handlers", false);
        const bound = yield* run(config, "handlers");

        for (const result of [plainContract, contract, plainHandlers, bound])
          assert.deepStrictEqual(errors(result), []);
        assert.deepStrictEqual(Option.getOrThrow(contract.collected.value).bindings, undefined);
        const collected = Option.getOrThrow(bound.collected.value);
        assert.strictEqual(collected.bindings?.[0]?.group.export, "Group");
        assert.strictEqual(collected.bindings?.[0]?.handlers.export, "handlers");
        const before = Option.getOrThrow(plainContract.ir.value);
        const after = Option.getOrThrow(bound.ir.value);
        assert.strictEqual(canonical(before), canonical(after));
        assert.strictEqual(yield* semanticHash(before), yield* semanticHash(after));
        assert.deepStrictEqual(
          Option.getOrThrow(contract.files.value),
          Option.getOrThrow(plainContract.files.value),
        );

        for (const file of Option.getOrThrow(contract.files.value))
          assert.notInclude(file.contents, "_binding-backend");

        const unbound = Option.getOrThrow(plainHandlers.files.value).find(
          (file) => file.path === "binding-handlers.ts",
        )!.contents;

        const generated = Option.getOrThrow(bound.files.value).find(
          (file) => file.path === "binding-handlers.ts",
        )!.contents;

        // Same native registration, constraints and completion; bound mode adds only its explicit wrapper.
        const normalized = generated
          .slice(0, generated.indexOf("const __effxCheckedGuards"))
          .replace(/^import .*_binding-backend.*\n/mu, "")
          .replace("export type BindingEndpoints", "type BindingEndpoints")
          .replace("export const BindingApiHandlersWith", "export const BindingApiHandlers")
          .trimEnd();

        assert.strictEqual(normalized, unbound.trimEnd());
        assert.include(generated, "complete: (handlers: ReturnType<typeof register>)");
        assert.include(generated, "BindingApiHandlersWith({");
        assert.include(generated, "export type BindingRaw");
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "checks bound native remainder completion through the installed stable Effect types",
    () =>
      Effect.gen(function* () {
        const { config, directory } = yield* fixture(
          "export const Bound = B.group(ImportedGroup, { handlers, guards });",
        );

        const result = yield* run(config, "handlers");
        assert.deepStrictEqual(errors(result), []);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const output = path.join(directory, ".effx", "generated");
        yield* fs.makeDirectory(output, { recursive: true });

        for (const file of Option.getOrThrow(result.files.value))
          yield* fs.writeFileString(path.join(output, file.path), file.contents);
        const witness = path.join(directory, "src", "_binding-witness.ts");
        yield* fs.writeFileString(
          witness,
          `
import { Effect } from "effect";
import { BindingApiHandlers, BindingApiHandlersWith } from "../.effx/generated/binding-handlers.ts";
import { handlers as makeRaw, guards as makeGuards } from "./_binding-backend.ts";
export const Bound = BindingApiHandlers("bound")((handlers) => handlers.handle("native", () => Effect.succeed("manual")));
export const Injected = BindingApiHandlersWith({ raw: makeRaw("injected"), guards: { ...makeGuards("guard"), "binding.read": () => Effect.succeed("override") } })((handlers) => handlers.handle("native", () => Effect.succeed("manual")));
// @ts-expect-error the native endpoint still requires completion.
export const Incomplete = BindingApiHandlers("bound")((handlers) => handlers);
`,
        );
        const text = yield* fs.readFileString(config);

        const diagnostics = yield* tryTs("bound-stable-native-completion", () => {
          const json = ts.parseConfigFileTextToJson(config, text);
          const parsed = ts.parseJsonConfigFileContent(json.config, ts.sys, directory);
          const program = ts.createProgram([witness], parsed.options);

          return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
          );
        });

        assert.deepStrictEqual(diagnostics, []);
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "accepts an explicitly exported decorated group class",
    () =>
      Effect.gen(function* () {
        const { config, directory } = yield* fixture(
          "export const Bound = B.group(ImportedGroup, { handlers, guards });",
        );

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(
          path.join(directory, "src", "_binding-declarations.ts"),
          declarations.replace(
            'export const Group = Http.group({ root: Api, group: "binding" });',
            '@Http.Group({ root: Api, group: "binding" })\nexport class Group {}',
          ),
        );
        const result = yield* run(config, "handlers");
        assert.deepStrictEqual(errors(result), []);
        assert.strictEqual(
          Option.getOrThrow(result.collected.value).bindings?.[0]?.group.export,
          "Group",
        );
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "rejects canonical duplicates across distinct handler entries",
    () =>
      Effect.gen(function* () {
        const { config, directory } = yield* fixture(
          "export const Bound = B.group(ImportedGroup, { handlers, guards });",
        );

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(
          path.join(directory, "src", "_second.bind.ts"),
          bindingSource("export const Other = B.group(ImportedGroup, { handlers, guards });"),
        );

        const result = yield* compile(
          {
            tsconfigPath: config,
            emit: "handlers",
            entry: ["src/_binding-declarations.ts", "src/_binding.bind.ts", "src/_second.bind.ts"],
          },
          Extensions.builtin,
        );

        assert.include(
          result.diagnostics.map((diagnostic) => diagnostic.code),
          "EFFX2422",
        );
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "diagnoses mixed local/external effx ownership without rejecting native remainder ownership",
    () =>
      Effect.gen(function* () {
        const { config, directory } = yield* fixture(
          "export const Bound = B.group(ImportedGroup, { handlers, guards });",
        );

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(
          path.join(directory, "src", "_binding-declarations.ts"),
          declarations
            .replace(
              'HttpApiEndpoint.get("native", "/native", { success: Success }),',
              'HttpApiEndpoint.get("native", "/native", { success: Success }),\n    HttpApiEndpoint.get("local", "/local", { success: Success }),',
            )
            .replace(".in(LocalGroup)", ".in(Group)")
            .replace('name: "local.read"', 'name: "binding.local"')
            .replace(
              'group: "local", success: Success, metadata: { operationId: "local.read" }',
              'group: "binding", success: Success, metadata: { operationId: "binding.local" }',
            ),
        );
        const result = yield* run(config, "handlers");
        assert.include(
          result.diagnostics.map((diagnostic) => diagnostic.code),
          "EFFX2424",
        );
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "guardFor uses each concrete root endpoint without importing endpoint constants",
    () =>
      Effect.gen(function* () {
        const { config } = yield* fixture(
          "export const Bound = B.group(ImportedGroup, { handlers, guardFor });",
        );

        const result = yield* run(config, "handlers");
        assert.deepStrictEqual(errors(result), []);

        const generated = Option.getOrThrow(result.files.value).find(
          (file) => file.path === "binding-handlers.ts",
        )!.contents;

        assert.include(
          generated,
          '__effxGuardFor(__effxRootApi.groups["binding"].endpoints["read"])',
        );
        assert.notInclude(generated, 'endpoints["native"]');
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect.each([
    ["EFFX2420", "export const Bound = B.group(Success, { handlers, guards });"],
    ["EFFX2421", "export const Bound = B.group(ImportedGroup, { handlers: () => ({}), guards });"],
    ["EFFX2421", "export const Bound = B.group(ImportedGroup, { handlers: notFunction, guards });"],
    [
      "EFFX2421",
      "const hidden = () => ({}); export const Bound = B.group(ImportedGroup, { handlers: hidden, guards });",
    ],
    [
      "EFFX2422",
      "export const One = B.group(ImportedGroup, { handlers, guards }); export const Two = B.group(ImportedGroup, { handlers, guardFor });",
    ],
    ["EFFX2423", "export const Bound = B.group(ImportedGroup, { handlers, guards, guardFor });"],
    ["EFFX2423", "export const Bound = B.group(ImportedGroup, { handlers });"],
    ["EFFX2423", "export const Bound = B.group(ImportedGroup, { guards });"],
    ["EFFX2424", "export const Bound = B.group(LocalGroup, { handlers, guards });"],
    ["EFFX2424", "export const Bound = B.group(EmptyGroup, { handlers, guards });"],
  ] as const)(
    "rejects %s: %s",
    ([code, source]) =>
      Effect.gen(function* () {
        const { config } = yield* fixture(source);
        const result = yield* run(config, "handlers");
        assert.include(
          result.diagnostics.map((diagnostic) => diagnostic.code),
          code,
        );
        assert.isTrue(Option.isNone(result.files.value));
        const contract = yield* run(config, "contract");
        assert.deepStrictEqual(errors(contract), []);
      }).pipe(Effect.provide(Services)),
    120_000,
  );
});
