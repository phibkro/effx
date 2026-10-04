import { assert, describe, it } from "@effect/vitest";
import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import {
  Annotation,
  AnnotationArg,
  type Collected,
  type Declaration,
  Extensions,
  HandlerSignature,
  SourceFrontend,
  compile,
} from "@effx/compiler";
import { type ApplicationIR, Node, canonical, make } from "@effx/ir";
import { TsSourceFrontend } from "@effx/frontend-ts";

const tsconfigPath = new URL("./fixtures/users/tsconfig.json", import.meta.url).pathname;

const fixtureRoot = new URL("./fixtures/users/", import.meta.url).pathname;

const repoRoot = new URL("../../../", import.meta.url).pathname;

/** The TS frontend over Bun's platform services: the only composition root in this package. */
const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const analyzeEntry = (entry: ReadonlyArray<string>) =>
  SourceFrontend.use((frontend) => frontend.analyze({ tsconfigPath, entry: [...entry] }));

const compileEntry = (entry: ReadonlyArray<string>, strictAccess = false) =>
  compile({ tsconfigPath, entry: [...entry], strictAccess }, Extensions.builtin);

/** Expected values are written as JSON and decoded, so branded ids are constructed, never asserted. */
const expectArgs = Schema.decodeUnknownEffect(Schema.Array(AnnotationArg));

const expectSignature = Schema.decodeUnknownEffect(HandlerSignature);

const expectAnnotations = Schema.decodeUnknownEffect(Schema.Array(Annotation));

const GeneratedTsconfig = Schema.Struct({
  extends: Schema.String,
  include: Schema.Array(Schema.String),
  compilerOptions: Schema.Struct({
    paths: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  }),
});

const GeneratedTsconfigString = Schema.fromJsonString(GeneratedTsconfig);

const byId = (collected: Collected): ReadonlyMap<string, Declaration> =>
  new Map(collected.declarations.map((declaration) => [declaration.id, declaration]));

const codes = (diagnostics: ReadonlyArray<{ readonly code: string }>): ReadonlyArray<string> =>
  diagnostics.map((d) => d.code).toSorted();

const errors = <D extends { readonly severity: string }>(
  diagnostics: ReadonlyArray<D>,
): ReadonlyArray<D> => diagnostics.filter((d) => d.severity === "error");

/** Syntax equivalence holds modulo the handler symbol, which is syntax-bound by nature (spec 0002). */
const eraseHandlers = (ir: ApplicationIR): ApplicationIR =>
  make(
    ir.nodes.map((node) =>
      Node.matchOrElse(
        node,
        {
          Operation: (operation): Node => ({
            ...operation,
            handler: { module: "<handler>", export: "<handler>" },
          }),
        },
        (other) => other,
      ),
    ),
    ir.edges,
  );

describe("TsSourceFrontend", () => {
  it.effect("collects the decorator-style User slice", () =>
    Effect.gen(function* () {
      const collected = yield* analyzeEntry(["src/operations.ts"]);
      assert.deepStrictEqual(errors(collected.diagnostics), []);
      assert.deepStrictEqual(codes(collected.diagnostics), ["EFFX0001"]);
      assert.deepStrictEqual(collected.declarations.map((d) => d.id).toSorted(), [
        "User",
        "UserOperations.changeEmail",
        "UserOperations.get",
      ]);
      const change = byId(collected).get("UserOperations.changeEmail")!;
      assert.strictEqual(change.kind, "staticMethod");
      assert.strictEqual(change.module, "../../src/operations");
      assert.deepStrictEqual(
        change.annotations.map((a) => a.name),
        ["Command", "Http.Patch", "Rpc", "Cli", "Authorize", "Errors", "Requirements"],
      );
      assert.deepStrictEqual(
        change.annotations[0]!.args,
        yield* expectArgs([
          {
            name: "User.ChangeEmail",
            input: {
              _tag: "Schema",
              ref: {
                module: "../../src/schemas",
                export: "ChangeEmailInput",
                symbolId: "schema:src/schemas/ChangeEmailInput",
              },
            },
            success: {
              _tag: "Schema",
              ref: {
                module: "../../src/user",
                export: "User",
                symbolId: "schema:src/user/User.Self",
              },
            },
          },
        ]),
      );
      assert.deepStrictEqual(
        change.annotations[4]!.args,
        yield* expectArgs([{ name: "User.ChangeEmail", resource: "User", focus: ["email"] }]),
      );
      assert.deepStrictEqual(
        change.handlerSignature,
        yield* expectSignature({
          success: {
            _tag: "Schema",
            ref: { module: "../../src/user", export: "User", symbolId: "schema:src/user/User" },
          },
          errors: [
            {
              _tag: "Schema",
              errorTag: "UserNotFound",
              ref: {
                module: "../../src/errors",
                export: "UserNotFound",
                symbolId: "schema:src/errors/UserNotFound",
              },
            },
            {
              _tag: "Schema",
              errorTag: "EmailTaken",
              ref: {
                module: "../../src/errors",
                export: "EmailTaken",
                symbolId: "schema:src/errors/EmailTaken",
              },
            },
          ],
          requirements: [
            {
              _tag: "Service",
              id: "service:Users",
              symbol: { module: "../../src/services", export: "Users" },
            },
            {
              _tag: "Service",
              id: "service:Audit",
              symbol: { module: "../../src/services", export: "Audit" },
            },
          ],
        }),
      );
      const model = byId(collected).get("User")!;
      assert.deepStrictEqual(
        model.annotations,
        yield* expectAnnotations([
          {
            name: "PersistentModel",
            args: [
              {
                table: "users",
                focus: { email: ["email"] },
                schema: {
                  _tag: "Schema",
                  ref: {
                    module: "../../src/user",
                    export: "User",
                    symbolId: "schema:src/user/User",
                  },
                },
              },
            ],
          },
        ]),
      );
    }).pipe(Effect.provide(Services)),
  );

  it.effect("builder chains lower to the same annotations and signatures as decorators", () =>
    Effect.gen(function* () {
      const decorators = byId(yield* analyzeEntry(["src/operations.ts"]));

      const builders = byId(
        yield* analyzeEntry(["src/operations.builder.ts", "src/user.builder.ts"]),
      );

      const pairs: ReadonlyArray<readonly [string, string]> = [
        ["UserOperations.get", "getUser"],
        ["UserOperations.changeEmail", "changeUserEmail"],
      ];

      for (const [decorated, built] of pairs) {
        const a = decorators.get(decorated)!;
        const b = builders.get(built)!;
        assert.strictEqual(b.kind, "builder");
        assert.strictEqual(b.member, "handler");
        assert.deepStrictEqual(b.annotations, a.annotations);
        assert.deepStrictEqual(b.handlerSignature, a.handlerSignature);
      }

      assert.deepStrictEqual(
        builders.get("UserModel")!.annotations,
        decorators.get("User")!.annotations,
      );
    }).pipe(Effect.provide(Services)),
  );

  it.effect(
    "both syntaxes compile to identical canonical IR (modulo handler symbol) through the real pipeline",
    () =>
      Effect.gen(function* () {
        const a = yield* compileEntry(["src/operations.ts"]);
        const b = yield* compileEntry(["src/operations.builder.ts"]);
        assert.deepStrictEqual(errors(a.diagnostics), []);
        assert.deepStrictEqual(errors(b.diagnostics), []);
        const irA = Option.getOrThrow(a.ir.value);
        const irB = Option.getOrThrow(b.ir.value);
        assert.strictEqual(canonical(eraseHandlers(irA)), canonical(eraseHandlers(irB)));
        assert.notStrictEqual(canonical(irA), canonical(irB));
        assert.includeMembers(
          irA.nodes.map((n) => n.id),
          [
            "model:User",
            "operation:User.Get",
            "operation:User.ChangeEmail",
            "capability:User.ChangeEmail",
            "focus:User.email",
            "service:Audit",
          ],
        );
      }).pipe(Effect.provide(Services)),
  );

  it.effect("assertion and addressability diagnostics fire from real handler types", () =>
    Effect.gen(function* () {
      const result = yield* compileEntry(["src/broken.ts"]);
      assert.deepStrictEqual(codes(errors(result.diagnostics)), [
        "EFFX2201",
        "EFFX2203",
        "EFFX2304",
      ]);
      assert.isTrue(Option.isNone(result.files.value));
      const undeclared = result.diagnostics.find((d) => d.code === "EFFX2201")!;
      assert.include(undeclared.message, "schema:src/errors/EmailTaken");
    }).pipe(Effect.provide(Services)),
  );

  it.effect("decorators on instance members are rejected with a location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(fixtureRoot, "src", "_instance.ts");
      yield* fs.writeFileString(
        file,
        [
          'import { Effect } from "effect";',
          'import { Query } from "@effx/runtime";',
          'import { GetUserInput } from "./schemas.ts";',
          'import { User } from "./user.ts";',
          "export class Bad {",
          "  @Query({ input: GetUserInput, success: User.Public })",
          "  get() { return Effect.void; }",
          "}",
          "",
        ].join("\n"),
      );
      yield* Effect.addFinalizer(() => fs.remove(file).pipe(Effect.ignore));
      const collected = yield* analyzeEntry(["src/_instance.ts"]);
      const rejected = collected.diagnostics.filter((d) => d.code === "EFFX1104");
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0]!.location?.file, file);
      assert.strictEqual(rejected[0]!.location?.line, 6);
      assert.deepStrictEqual(
        collected.declarations.filter((d) => d.id.startsWith("Bad")),
        [],
      );
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("HTTP contract decorators and builders normalize to the same IR", () =>
    Effect.gen(function* () {
      const decorator = yield* compileEntry(["src/operations.contract.ts"]);
      const builder = yield* compileEntry(["src/operations.contract.builder.ts"]);
      assert.deepStrictEqual(errors(decorator.diagnostics), []);
      assert.deepStrictEqual(errors(builder.diagnostics), []);
      const a = Option.getOrThrow(decorator.ir.value);
      const b = Option.getOrThrow(builder.ir.value);
      assert.strictEqual(canonical(eraseHandlers(a)), canonical(eraseHandlers(b)));
      assert.includeMembers(
        a.edges.map((edge) => edge.kind),
        ["ExtensionOf"],
      );

      const http = Option.getOrThrow(decorator.files.value).find(
        (file) => file.path === "http.ts",
      )!.contents;

      assert.include(http, 'HttpApiGroup.make("users")');
      assert.include(http, "params: ContractParams");
      assert.include(http, "query: ContractQuery");
      assert.include(http, "headers: ContractHeaders");
      assert.include(http, ".middleware(RequestMarker)");
      assert.include(http, 'UserProblemResponses("contractGetProblem", ["user.not-found"])');
      assert.include(http, 'identifier: "users.contractGet"');
    }).pipe(Effect.provide(Services)),
  );

  it.effect("unsupported HTTP combinations and incomplete problems block generation", () =>
    Effect.gen(function* () {
      const result = yield* compileEntry(["src/operations.contract-invalid.ts"]);
      assert.includeMembers(
        [...codes(errors(result.diagnostics))],
        ["EFFX2402", "EFFX2205", "EFFX2206"],
      );
      assert.isTrue(
        result.diagnostics.some(
          (finding) =>
            finding.code === "EFFX2402" &&
            finding.message.includes("params schema fields must match path parameters"),
        ),
      );
      assert.isTrue(Option.isNone(result.files.value));
    }).pipe(Effect.provide(Services)),
  );
  it.effect("HTTP status, media, conditional responses, and roots are emitted", () =>
    Effect.gen(function* () {
      const result = yield* compileEntry(["src/operations.contract-rich.ts"]);
      assert.deepStrictEqual(errors(result.diagnostics), []);
      const files = Option.getOrThrow(result.files.value);
      const http = files.find((file) => file.path === "http.ts")!.contents;
      assert.include(http, 'HttpApi.make("admin")');
      assert.include(http, 'HttpApi.make("effx")');
      assert.include(http, "HttpApiSchema.status(201)");
      assert.include(http, 'HttpApiSchema.asJson({ contentType: "application/vnd.user+json" })');
      assert.include(http, "HttpApiSchema.WithHeaders(User.Public, ContractResponseHeaders)");
      assert.include(
        http,
        "HttpApiSchema.WithHeaders(HttpApiSchema.NoContent.pipe(HttpApiSchema.status(304)), ContractResponseHeaders)",
      );
      const client = files.find((file) => file.path === "client.ts")!.contents;
      assert.include(client, "class AdminClient");
      assert.include(client, 'client["users"]["User.ContractPost"]');
    }).pipe(Effect.provide(Services)),
  );
  it.effect("a statically status-annotated error needs no code mapping", () =>
    Effect.gen(function* () {
      const result = yield* compileEntry(["src/operations.contract-status.ts"]);
      assert.deepStrictEqual(errors(result.diagnostics), []);
      assert.isTrue(Option.isSome(result.files.value));
    }).pipe(Effect.provide(Services)),
  );
  it.effect("Profile AccessContract decorators and builders share canonical IR", () =>
    Effect.gen(function* () {
      const decorated = yield* compileEntry(["src/operations.access.ts"]);
      const built = yield* compileEntry(["src/operations.access.builder.ts"]);

      assert.deepStrictEqual(errors(decorated.diagnostics), []);
      assert.deepStrictEqual(errors(built.diagnostics), []);
      const ir = Option.getOrThrow(decorated.ir.value);
      assert.strictEqual(
        canonical(eraseHandlers(ir)),
        canonical(eraseHandlers(Option.getOrThrow(built.ir.value))),
      );
      assert.strictEqual(
        ir.nodes.filter((node) => node._tag === "Extension" && node.tag === "AccessContract")
          .length,
        2,
      );
      const files = Option.getOrThrow(decorated.files.value);
      const http = files.find((file) => file.path === "http.ts")!.contents;
      const guards = files.find((file) => file.path === "guards.ts")!.contents;
      assert.include(http, ".middleware(ProfilePersonSecurity)");
      assert.include(http, ".annotateMerge(profileAccessAnnotations({");
      assert.include(http, "ProfileCurrentPerson");
      assert.include(http, "(guards: ProfileGuards)");
      assert.include(http, "AppRoutes = (guards: AppGuards)");
      assert.include(http, '() => guards["Profile.Update"](request)');
      assert.include(
        guards,
        'readonly "Profile.Read": (request: HttpServerRequest.HttpServerRequest)',
      );
      assert.include(
        guards,
        'readonly "Profile.Update": (request: HttpServerRequest.HttpServerRequest)',
      );
    }).pipe(Effect.provide(Services)),
  );

  it.effect("invalid access decisions and missing security guards diagnose both modes", () =>
    Effect.gen(function* () {
      const project = ["src/operations.access-invalid.ts"];
      const normal = yield* compileEntry(project);
      const strict = yield* compileEntry(project, true);
      const findings = normal.diagnostics;
      assert.includeMembers([...codes(findings)], ["EFFX2501", "EFFX2502", "EFFX2503", "EFFX2504"]);
      assert.strictEqual(
        findings.find((finding) => finding.code === "EFFX2504")?.severity,
        "warning",
      );
      assert.strictEqual(
        strict.diagnostics.find((finding) => finding.code === "EFFX2504")?.severity,
        "error",
      );
      assert.isTrue(Option.isNone(normal.files.value));
      assert.isTrue(Option.isNone(strict.files.value));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("decorator and builder Profile commands normalize to the same Foldkit IR", () =>
    Effect.gen(function* () {
      const decoratorEntry = ["src/operations.client-foldkit.ts"];
      const builderEntry = ["src/operations.client-foldkit.builder.ts"];
      const decorated = byId(yield* analyzeEntry(decoratorEntry));
      const built = byId(yield* analyzeEntry(builderEntry));

      for (const [method, builder] of [
        ["ClientFoldkitProfileOperations.read", "clientFoldkitRead"],
        ["ClientFoldkitProfileOperations.update", "clientFoldkitUpdate"],
        ["ClientFoldkitInternalOperations.read", "clientFoldkitInternalRead"],
      ] as const) {
        assert.deepStrictEqual(built.get(builder)!.annotations, decorated.get(method)!.annotations);
        assert.deepStrictEqual(
          built.get(builder)!.handlerSignature,
          decorated.get(method)!.handlerSignature,
        );
      }

      assert.include(
        decorated
          .get("ClientFoldkitProfileOperations.update")!
          .annotations.map((item) => item.name),
        "Foldkit.Command",
      );

      const a = yield* compileEntry(decoratorEntry);
      const b = yield* compileEntry(builderEntry);
      assert.deepStrictEqual(errors(a.diagnostics), []);
      assert.deepStrictEqual(errors(b.diagnostics), []);
      const ir = Option.getOrThrow(a.ir.value);
      assert.strictEqual(
        canonical(eraseHandlers(ir)),
        canonical(eraseHandlers(Option.getOrThrow(b.ir.value))),
      );
      assert.strictEqual(
        ir.nodes.filter(
          (node) =>
            node._tag === "Extension" && node.extension === "foldkit" && node.tag === "UiCommand",
        ).length,
        1,
      );
      assert.include(
        ir.edges.map((edge) => edge.kind),
        "ExtensionOf",
      );

      const files = Option.getOrThrow(a.files.value);
      const http = files.find((file) => file.path === "http.ts")!.contents;
      const client = files.find((file) => file.path === "client.ts")!.contents;
      assert.include(http, 'HttpApi.make("internal")');
      assert.include(client, "ProfileUpdateCommandIdentity");
      assert.notInclude(client, "InternalProfileRead");
      assert.isTrue(files.some((file) => file.path === "foldkit.ts"));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("invalid identity metadata and a mixed internal root block client generation", () =>
    Effect.gen(function* () {
      const identity = yield* compileEntry(["src/operations.client-foldkit.invalid-identity.ts"]);
      assert.includeMembers([...codes(errors(identity.diagnostics))], ["EFFX1102", "EFFX2402"]);
      assert.isAtLeast(
        identity.diagnostics.filter((finding) => finding.code === "EFFX2402").length,
        3,
      );
      assert.isTrue(
        identity.diagnostics.some(
          (finding) =>
            finding.code === "EFFX2402" && finding.message.includes("duplicate @Http.Contract"),
        ),
      );
      assert.isAtLeast(
        identity.diagnostics.filter((finding) => finding.code === "EFFX1102").length,
        1,
      );
      assert.isTrue(Option.isNone(identity.files.value));

      const mixed = yield* compileEntry(["src/operations.client-foldkit.mixed-root.ts"]);
      assert.include(codes(errors(mixed.diagnostics)), "EFFX2505");
      assert.isTrue(Option.isNone(mixed.files.value));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("an unexported Foldkit Message symbol cannot enter generated output", () =>
    Effect.gen(function* () {
      const result = yield* compileEntry(["src/operations.client-foldkit.invalid-message.ts"]);
      assert.include(codes(errors(result.diagnostics)), "EFFX1102");
      assert.isTrue(Option.isNone(result.files.value));
    }).pipe(Effect.provide(Services)),
  );
  it.effect(
    "generated Effect code typechecks against the fixture project with tsc",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const result = yield* compileEntry([
          "src/operations.ts",
          "src/operations.contract.ts",
          "src/operations.contract-rich.ts",
          "src/operations.contract-status.ts",
          "src/operations.client-foldkit.ts",
          "src/operations.content-actions.ts",
        ]);

        assert.deepStrictEqual(errors(result.diagnostics), []);
        const files = Option.getOrThrow(result.files.value);
        assert.includeMembers(
          files.map((file) => file.path),
          ["client.ts", "foldkit.ts", "http.ts", "guards.ts"],
        );
        const http = files.find((file) => file.path === "http.ts")!.contents;
        assert.include(http, 'HttpApiGroup.make("users")');
        assert.include(
          http,
          'HttpApiEndpoint.post("publishArticle", "/api/content/articles/:articleId:publish"',
        );
        assert.include(
          http,
          'HttpApiEndpoint.post("unpublishArticle", "/api/content/articles/:articleId:unpublish"',
        );
        assert.strictEqual(Array.from(http.matchAll(/params: ContentArticleParams/g)).length, 2);
        const client = files.find((file) => file.path === "client.ts")!.contents;
        assert.include(client, 'client["users"]["contractGet"]');
        const outDir = path.join(fixtureRoot, ".effx", "generated");
        yield* fs.makeDirectory(outDir, { recursive: true });

        for (const file of files) {
          yield* fs.writeFileString(path.join(outDir, file.path), file.contents);
        }

        const generatedConfig = path.join(fixtureRoot, ".effx", "tsconfig.generated.json");

        const generatedConfigText = yield* Schema.encodeEffect(GeneratedTsconfigString)({
          extends: "../tsconfig.json",
          include: ["../src/**/*.ts", "./generated/*.ts"],
          compilerOptions: {
            paths: { "@effx/runtime": ["../../../../../runtime/src/index.ts"] },
          },
        });

        yield* fs.writeFileString(generatedConfig, generatedConfigText);

        const output = yield* Effect.sync(() => {
          const result = Bun.spawnSync(
            ["bun", "--bun", "node_modules/.bin/tsc", "--noEmit", "-p", generatedConfig],
            { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
          );

          return {
            text: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
            code: result.exitCode,
          };
        });

        assert.strictEqual(output.code, 0, `tsc output:\n${output.text}`);
      }).pipe(Effect.provide(Services)),
    60_000,
  );
});
