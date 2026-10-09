import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import {
  CompilerFault,
  EffectModel,
  Extensions,
  LiftFrontend,
  StageResult,
  SourceFrontend,
  compileCollected,
  dense,
  lift,
  nativeCalleeOf,
  nativeName,
  printSuggestion,
  type ProjectConfig,
} from "@effx/compiler";
import { LiftTsSourceFrontend, TsSourceFrontend } from "@effx/frontend-ts";
import { canonical } from "@effx/ir";
import {
  Crypto,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Result,
  Schema,
} from "effect";
import { Hex } from "effect/encoding";
import { testDirectory } from "../../../tools/testing/projects.ts";

const repo = new URL("../../../", import.meta.url).pathname;

const Services = Layer.mergeAll(LiftTsSourceFrontend.layer, TsSourceFrontend.layer).pipe(
  Layer.provideMerge(BunServices.layer),
);

const decodeModel = Schema.decodeUnknownEffect(EffectModel);

const encodeRootId = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

const project = Effect.fnUntraced(function* (source: string, support = "") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* testDirectory("lift-frontend-");
  yield* fs.makeDirectory(path.join(directory, "src"));
  yield* fs.writeFileString(
    path.join(directory, "tsconfig.json"),
    `{
    "extends": "${repo}tsconfig.json", "include": ["src/api.ts"], "exclude": [],
    "effx": { "projectRoot": "." }
  }`,
  );
  yield* fs.writeFileString(path.join(directory, "src/api.ts"), source);
  yield* fs.writeFileString(path.join(directory, "src/support.ts"), support);

  return { directory, tsconfigPath: path.join(directory, "tsconfig.json") };
});

const support = `import { Schema } from "effect";
import { HttpApiSchema, HttpApiMiddleware } from "effect/http-api";
import { Http } from "@effx/runtime";
const PrivateInput = Schema.Struct({ id: Schema.String });
export { PrivateInput as Input };
export class Responses { static Public = Schema.Struct({ answer: Schema.String }); }
export const Headers = Http.headers(Schema.Struct({ required: Schema.String, optional: Schema.optionalKey(Schema.String) }));
export class Marker extends HttpApiMiddleware.Service<Marker>()("test/Marker") {}
export const Codes = ["test.one", "test.two"] as const;
export const ReadonlyTypeOnly: readonly ["invented.code"] = getCodes();
declare function getCodes(): readonly ["invented.code"];
export const wrap = (schema: typeof Responses.Public) => HttpApiSchema.WithHeaders(schema, Headers);
export const opaque = (value: string) => value;
export const handler = () => Effect.succeed("handled");
import { Effect } from "effect";`;

const source = `// UTF-16 witness: 𝄞
import { HttpApi as Api, HttpApiEndpoint as Endpoint, HttpApiGroup as Group, HttpApiSchema as Wire, OpenApi, HttpApiBuilder } from "effect/http-api";
import { get as directGet } from "effect/http-api/HttpApiEndpoint";
import { Input as Request, Responses, Headers, Marker, wrap, handler } from "./support.js";
export const Read = Endpoint.get("read", "/read", { query: Request, success: wrap(Responses.Public.pipe(Wire.status(200))), error: Schema.Never }).middleware(Marker).annotateMerge(OpenApi.annotations({ summary: "Read" }));
export const Direct = directGet("direct", "/direct", { query: Request, success: Responses.Public, error: Schema.Never });
export class PublicGroup extends Group.make("public").add(Read, Direct) {}
export class Root extends Api.make("actual-root").add(PublicGroup) {}
export const Live = HttpApiBuilder.group(Root, "public", h => h.handleRaw("read", handler).handle("direct", () => Effect.succeed("raw")));
import { Effect, Schema } from "effect";`;

describe("production LiftTsSourceFrontend", () => {
  it("keeps construction inert and exposes exact channels", () => {
    let touched = 0;

    const config: ProjectConfig = {
      get tsconfigPath(): string {
        touched++;
        throw new Error("construction must not read config");
      },
    };

    const discarded = LiftTsSourceFrontend.analyze(config);
    assert.strictEqual(touched, 0);
    expectTypeOf(discarded).toEqualTypeOf<
      Effect.Effect<
        StageResult<EffectModel>,
        CompilerFault,
        FileSystem.FileSystem | Path.Path | Crypto.Crypto
      >
    >();
    expectTypeOf(discarded).not.toEqualTypeOf<
      Effect.Effect<StageResult<EffectModel>, CompilerFault>
    >();
    expectTypeOf(discarded).not.toEqualTypeOf<
      Effect.Effect<
        StageResult<EffectModel>,
        never,
        FileSystem.FileSystem | Path.Path | Crypto.Crypto
      >
    >();
    expectTypeOf(LiftTsSourceFrontend.layer).toEqualTypeOf<
      Layer.Layer<LiftFrontend, never, FileSystem.FileSystem | Path.Path | Crypto.Crypto>
    >();
    expectTypeOf<LiftFrontend["Service"]["analyze"]>().returns.toEqualTypeOf<
      Effect.Effect<StageResult<EffectModel>, CompilerFault>
    >();
  });

  it.effect(
    "reads helper closure, real export identities, native direct exports, source hashes and static facts",
    () =>
      Effect.gen(function* () {
        const fixture = yield* project(source, support);
        const frontend = yield* LiftFrontend;
        const analyzed = yield* frontend.analyze(fixture);
        const model = Option.getOrThrow(analyzed.value);
        yield* decodeModel(model);
        assert.strictEqual(model.target, "effect-4.0");
        assert.strictEqual(model.endpoints.length, 2);
        assert.strictEqual(model.groups.length, 1);
        assert.strictEqual(model.roots[0]?.symbol.export, "Root");
        assert.isTrue(model.files.some((file) => file.idPath === "src/support"));
        assert.isTrue(
          model.schemas.some(
            (fact) => fact.ref.export === "Input" && fact.ref.symbolId.endsWith("/Input"),
          ),
        );
        assert.isTrue(
          model.schemas.some(
            (fact) =>
              fact.ref.export === "Responses" && fact.ref.symbolId.endsWith("/Responses.Public"),
          ),
        );
        const headers = model.schemas.find((fact) => fact.ref.export === "Headers");
        assert.deepStrictEqual(headers?.allKeys, ["optional", "required"]);
        assert.deepStrictEqual(headers?.requiredKeys, ["required"]);
        assert.strictEqual(headers?.headers, true);
        assert.deepStrictEqual(
          model.markers.map((fact) => [fact.ref.export, fact.security]),
          [["Marker", false]],
        );
        assert.strictEqual(
          model.wrappers.find((fact) => fact.helper.export === "wrap")?.headers._tag,
          "Named",
        );
        const direct = model.endpoints.find((endpoint) => endpoint.symbol.export === "Direct");
        assert.isDefined(direct);
        assert.strictEqual(direct?.callee._tag, "Lowered");

        if (direct?.callee._tag === "Lowered") {
          const native = nativeCalleeOf(model.target, model.natives, direct.callee.term);
          assert.strictEqual(native?.kind, "HttpApiEndpoint");
          assert.strictEqual(native === undefined ? undefined : nativeName(native), "get");
        }

        const fs = yield* FileSystem.FileSystem;
        const crypto = yield* Crypto.Crypto;
        const file = model.files.find((file) => file.idPath === "src/api");
        assert.isDefined(file);

        if (file !== undefined) {
          const text = yield* fs.readFileString(file.file);
          assert.strictEqual(
            file.sha256,
            Hex.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode(text))),
          );
          const read = model.endpoints[0];
          assert.strictEqual(read?.range.start.offset, source.indexOf("export const Read"));
          assert.strictEqual(read?.range.start.line, 5);
          assert.strictEqual(read?.range.start.col, 1);
          assert.isTrue(
            file.imports.some(
              (binding) => binding.local === "Request" && binding.ref.export === "Input",
            ),
          );
        }

        const binding = model.bindings[0];
        assert.deepStrictEqual(
          binding?.registrations.map((entry) =>
            entry._tag === "Registered" ? [entry.kind, entry.handler._tag] : entry._tag,
          ),
          [
            ["raw", "Exported"],
            ["normal", "Inline"],
          ],
        );
        const typedOnly = model.values.find((value) => value.symbol.export === "ReadonlyTypeOnly");
        assert.strictEqual(typedOnly?.init._tag, "Unlowered");
      }).pipe(Effect.provide(Services)),
  );

  it.effect(
    "never invents static schema exports or readonly tuple values from misleading types",
    () =>
      Effect.gen(function* () {
        const fixture = yield* project(
          `import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/http-api";
import { Schema } from "effect";
import { Input } from "./support.js";
export class PrivateSchemas { private static Hidden = Schema.String; Instance = Schema.String; }
export const MutableCodes = ["runtime.mutable"];
export const LyingCodes = ["runtime.actual"] as unknown as readonly ["type.invented"];
export const Private = HttpApiEndpoint.get("private", "/private", { query: Input, success: PrivateSchemas.Hidden, error: Schema.Never });
export const Instance = HttpApiEndpoint.get("instance", "/instance", { query: Input, success: new PrivateSchemas().Instance, error: Schema.Never });
export class G extends HttpApiGroup.make("bad-refs").add(Private, Instance) {}
export class R extends HttpApi.make("root").add(G) {}`,
          support,
        );

        const model = Option.getOrThrow((yield* (yield* LiftFrontend).analyze(fixture)).value);
        assert.isFalse(model.schemas.some((fact) => fact.ref.export === "PrivateSchemas"));
        assert.strictEqual(
          model.values.find((value) => value.symbol.export === "MutableCodes")?.init._tag,
          "Unlowered",
        );
        assert.strictEqual(
          model.values.find((value) => value.symbol.export === "LyingCodes")?.init._tag,
          "Unlowered",
        );

        const result = lift(model, {
          group: "bad-refs",
          rules: [],
          names: {},
          output: { module: "../../src/suggestion" },
        });

        assert.strictEqual(result.unsupported.length, 2);
        assert.isFalse(
          result.collected.declarations.some((declaration) =>
            declaration.annotations.some((annotation) => annotation.name === "Query"),
          ),
        );
      }).pipe(Effect.provide(Services)),
  );

  it.effect(
    "keeps every unsupported option and helper argument finding, without a partial term",
    () =>
      Effect.gen(function* () {
        const fixture = yield* project(
          `import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/http-api";
import { Input, opaque } from "./support.js";
const local = "dynamic";
export const Bad = HttpApiEndpoint.post("bad", local, { query: Input, payload: { ...Input.fields, [local]: Input }, success: opaque(local), error: opaque(local + "code") }).prefix("/unsupported").annotateMerge(opaque(local));
export class G extends HttpApiGroup.make("bad").add(Bad) {}
export class R extends HttpApi.make("root").add(G) {}`,
          support,
        );

        const model = Option.getOrThrow((yield* (yield* LiftFrontend).analyze(fixture)).value);
        const endpoint = model.endpoints[0];
        assert.strictEqual(endpoint?.options._tag, "Entries");

        if (endpoint?.options._tag === "Entries") {
          const payload = endpoint.options.entries.find(
            (entry) => entry._tag === "Property" && entry.name === "payload",
          );

          assert.strictEqual(payload?._tag, "Property");

          if (payload?._tag === "Property" && payload.value._tag === "Unlowered") {
            assert.deepStrictEqual(
              payload.value.findings.map((finding) => finding.kind),
              ["spread", "computed-key"],
            );
            assert.isFalse("term" in payload.value);
          }

          const success = endpoint.options.entries.find(
            (entry) => entry._tag === "Property" && entry.name === "success",
          );

          if (success?._tag === "Property" && success.value._tag === "Unlowered")
            assert.strictEqual(success.value.findings[0].enclosingCall?.callee.export, "opaque");
        }

        const result = lift(model, {
          group: "bad",
          rules: [],
          names: {},
          output: { module: "../../src/bad.effx" },
        });

        assert.strictEqual(result.unsupported.length, 1);
        assert.isFalse(
          result.collected.declarations.some((entry) =>
            entry.annotations.some(
              (annotation) => annotation.name === "Query" || annotation.name === "Command",
            ),
          ),
        );
        const primary = result.unsupported[0]?.primary;
        const causes = primary === undefined ? [] : [primary, ...(primary.related ?? [])];
        assert.isAtLeast(causes.length, 6);

        const positions = causes.map(
          (cause) => (cause.location?.line ?? 0) * 10000 + (cause.location?.col ?? 0),
        );

        assert.deepStrictEqual(
          positions,
          positions.toSorted((a, b) => a - b),
        );
      }).pipe(Effect.provide(Services)),
  );

  it.effect.each(["unresolved", "unsupported"] as const)(
    "keeps %s Effect target diagnostics as None for a real consumer",
    (kind) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "effx-missing-effect-" });
        yield* fs.writeFileString(path.join(directory, "api.ts"), "export const witness = 1;");

        const paths =
          kind === "unsupported"
            ? ', "paths": { "effect/package.json": ["./effect-package.json"] }'
            : "";

        yield* fs.writeFileString(
          path.join(directory, "tsconfig.json"),
          `{
        "compilerOptions": { "moduleResolution": "bundler", "module": "ESNext", "resolveJsonModule": true ${paths} }, "files": ["api.ts"]
      }`,
        );

        if (kind === "unsupported")
          yield* fs.writeFileString(
            path.join(directory, "effect-package.json"),
            '{"name":"effect","version":"3.19.0"}',
          );

        const result = yield* (yield* LiftFrontend).analyze({
          tsconfigPath: path.join(directory, "tsconfig.json"),
        });

        let lifts = 0;

        const suggestion = Option.map(result.value, (model) => {
          lifts++;

          return lift(model, {
            group: "absent",
            rules: [],
            names: {},
            output: { module: "../../suggestion" },
          });
        });

        assert.isTrue(Option.isNone(suggestion));
        assert.strictEqual(lifts, 0);
        assert.strictEqual(
          result.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX2701").length,
          1,
        );
      }).pipe(Effect.provide(Services)),
  );

  it.effect("returns IO faults, not an empty successful model", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        (yield* LiftFrontend).analyze({ tsconfigPath: "/effx-does-not-exist/tsconfig.json" }),
      );

      assert.strictEqual(failure._tag, "CompilerFault");
    }).pipe(Effect.provide(Services)),
  );

  it.effect(
    "substitutes Crypto without changing domain code and interrupts hashing with exactly one cleanup",
    () =>
      Effect.gen(function* () {
        const fixture = yield* project(source, support);
        const crypto = yield* Crypto.Crypto;
        const entered = yield* Deferred.make<void>();
        const block = yield* Deferred.make<Uint8Array>();
        let released = 0;

        const substitute = Layer.succeed(Crypto.Crypto, {
          ...crypto,
          digest: Effect.fnUntraced(
            function* () {
              yield* Deferred.succeed(entered, undefined);

              return yield* Deferred.await(block);
            },
            Effect.ensuring(
              Effect.sync(() => {
                released++;
              }),
            ),
          ),
        });

        const frontend = LiftTsSourceFrontend.layer.pipe(Layer.provide(substitute));

        const fiber = yield* Effect.forkChild(
          Effect.gen(function* () {
            return yield* (yield* LiftFrontend).analyze(fixture);
          }).pipe(Effect.provide(frontend)),
        );

        yield* Deferred.await(entered);
        yield* Fiber.interrupt(fiber);
        assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(fiber)));
        assert.strictEqual(released, 1);
        yield* Deferred.succeed(block, new Uint8Array(32));
        assert.strictEqual(released, 1);
      }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "L3/L4/L5 retain headered explicit 200 through real printing, recollection, compilation and generation",
    () =>
      Effect.gen(function* () {
        const fixture = yield* project(source, support);
        const analyzed = yield* (yield* LiftFrontend).analyze(fixture);
        const model = Option.getOrThrow(analyzed.value);
        const schema = model.schemas.find((fact) => fact.ref.export === "Headers")?.ref;
        assert.isDefined(schema);
        const helper = model.wrappers.find((fact) => fact.helper.export === "wrap")?.helper;
        assert.isDefined(helper);

        if (schema === undefined || helper === undefined) return;
        const output = "../../src/suggestion.effx";

        const result = lift(model, {
          group: "public",
          rules: [{ _tag: "SuccessWrapper", callee: helper, responseHeaders: schema }],
          names: {},
          output: { module: output },
        });

        assert.deepStrictEqual(result.unsupported, []);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const verbose = printSuggestion(result.collected, { module: output });
        assert.isTrue(Result.isSuccess(verbose));

        if (Result.isFailure(verbose)) return;
        yield* fs.writeFileString(
          path.join(fixture.directory, "src/suggestion.effx.ts"),
          verbose.success,
        );
        const forward = yield* SourceFrontend;

        const collected = yield* forward.analyze({
          ...fixture,
          entry: ["src/suggestion.effx.ts"],
          emit: "contract",
        });

        const compiled = yield* compileCollected(collected, Extensions.builtin);
        assert.deepStrictEqual(
          compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        const verboseIR = Option.getOrThrow(compiled.ir.value);
        const denseCollected = Option.getOrThrow(dense(result.collected));
        const denseText = printSuggestion(denseCollected, { module: output });
        assert.isTrue(Result.isSuccess(denseText));

        if (Result.isFailure(denseText)) return;
        yield* fs.writeFileString(
          path.join(fixture.directory, "src/suggestion.effx.ts"),
          denseText.success,
        );

        const recollected = yield* forward.analyze({
          ...fixture,
          entry: ["src/suggestion.effx.ts"],
          emit: "contract",
        });

        const denseCompiled = yield* compileCollected(recollected, Extensions.builtin);
        assert.strictEqual(
          canonical(verboseIR),
          canonical(Option.getOrThrow(denseCompiled.ir.value)),
        );
        const files = Option.getOrThrow(compiled.files.value);
        const generatedDirectory = path.join(fixture.directory, ".effx/generated");
        yield* fs.makeDirectory(generatedDirectory, { recursive: true });

        for (const file of files)
          yield* fs.writeFileString(path.join(generatedDirectory, file.path), file.contents);
        const generated = files.find((file) => file.path.endsWith("-contract.ts"));
        assert.isDefined(generated);

        if (generated === undefined) return;
        const frontend = yield* LiftFrontend;

        const generatedModel = Option.getOrThrow(
          (yield* frontend.analyze({ ...fixture, entry: [`.effx/generated/${generated.path}`] }))
            .value,
        );

        const generatedGroup = generatedModel.groups.find(
          (group) =>
            group.id._tag === "Lowered" &&
            group.id.term._tag === "Lit" &&
            group.id.term.json === "public",
        );

        const originalRoot = model.roots[0];
        assert.isDefined(generatedGroup);
        assert.isDefined(originalRoot);

        if (
          generatedGroup === undefined ||
          originalRoot === undefined ||
          originalRoot.id._tag !== "Lowered" ||
          originalRoot.id.term._tag !== "Lit"
        )
          return;
        const rootId = yield* encodeRootId(originalRoot.id.term.json);
        // Contract generation deliberately omits a root. This owned scratch composition keeps the real original root id and hash-bearing symbol.
        yield* fs.writeFileString(
          path.join(fixture.directory, "src/api.ts"),
          `import { HttpApi } from "effect/http-api";
import { ${generatedGroup.symbol.export} } from "../.effx/generated/${generated.path}";
export class ${originalRoot.symbol.export} extends HttpApi.make(${rootId}).add(${generatedGroup.symbol.export}) {}`,
        );

        const reliftedModel = Option.getOrThrow(
          (yield* frontend.analyze({ ...fixture, entry: ["src/api.ts"] })).value,
        );

        const relifted = lift(reliftedModel, {
          group: "public",
          rules: [],
          names: {},
          output: { module: output },
        });

        assert.deepStrictEqual(
          relifted.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        assert.deepStrictEqual(relifted.unsupported, []);

        const recovered = yield* compileCollected(
          collected.project === undefined
            ? relifted.collected
            : { ...relifted.collected, project: collected.project },
          Extensions.builtin,
        );

        assert.strictEqual(canonical(verboseIR), canonical(Option.getOrThrow(recovered.ir.value)));
      }).pipe(Effect.provide(Services)),
  );
});
