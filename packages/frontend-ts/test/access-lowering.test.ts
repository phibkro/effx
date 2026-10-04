import { copyUsersFixture } from "../../../tools/testing/projects.ts";
import { assert, describe, it } from "@effect/vitest";
import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { AnnotationArg, ProjectConfig, SourceFrontend } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";

const tsconfigPath = new URL("./fixtures/users/tsconfig.json", import.meta.url).pathname;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const source = `
import { Effect } from "effect";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";
import { Http, Operation, Query } from "@effx/runtime";
import { RequestMarker } from "./contract-support.ts";

export function deriveAnnotations(spec: unknown) { return spec; }
export const resolveScope = (_input: unknown) => "scope";
export class PersonSecurity extends HttpApiMiddleware.Service<PersonSecurity>()(
  "test/PersonSecurity", { security: { bearer: HttpApiSecurity.bearer } }
) {}

export class AccessOperations {
  @Query({ name: "Access.Read" })
  @Http.Get("/access")
  @Http.Contract({ group: "access", middleware: [PersonSecurity, RequestMarker] })
  @Http.Access({
    annotator: deriveAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person"],
    capabilities: { _tag: "None" },
    requirements: [],
    canonicalScopeResolver: resolveScope,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead"
  })
  static read() { return Effect.succeed("ok"); }
}

export const readAccess = Operation.query({ name: "Access.Read" })
  .http.get("/access")
  .http.contract({ group: "access", middleware: [PersonSecurity, RequestMarker] })
  .http.access({
    annotator: deriveAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person"],
    capabilities: { _tag: "None" },
    requirements: [],
    canonicalScopeResolver: resolveScope,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead"
  })
  .handler(() => Effect.succeed("ok"));

export class InvalidAccess {
  @Http.Access({ annotator: deriveAnnotations, canonicalScopeResolver: resolveScope,
    requirements: [{ id: "owner", parameters: { callback: deriveAnnotations } }] })
  static read() { return Effect.succeed("ok"); }
}

const hiddenResolver = (_input: unknown) => "scope";
export class HiddenAccess {
  @Http.Access({ annotator: deriveAnnotations, canonicalScopeResolver: hiddenResolver })
  static read() { return Effect.succeed("ok"); }
}
`;

describe("access annotation lowering", () => {
  it.effect(
    "maps both syntaxes to identical access arguments and stamps only security middleware",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixtureRoot = yield* copyUsersFixture();
        const projectConfig = path.join(fixtureRoot, "tsconfig.json");
        const fixture = path.join(fixtureRoot, "src", "_access-lowering.ts");
        yield* fs.writeFileString(fixture, source);
        yield* Effect.addFinalizer(() => fs.remove(fixture).pipe(Effect.ignore));

        const collected = yield* SourceFrontend.use((frontend) =>
          frontend.analyze({ tsconfigPath: projectConfig, entry: ["src/_access-lowering.ts"] }),
        );

        const decorated = collected.declarations.find(
          (item) => item.id === "AccessOperations.read",
        )!;

        const built = collected.declarations.find((item) => item.id === "readAccess")!;

        const names = decorated.annotations.map((annotation) => annotation.name);
        assert.deepStrictEqual(names, ["Query", "Http.Get", "Http.Contract", "Http.Access"]);
        assert.deepStrictEqual(built.annotations, decorated.annotations);

        const access = decorated.annotations[3]!.args[0];

        const expected = yield* Schema.decodeEffect(AnnotationArg)({
          annotator: {
            _tag: "Symbol",
            ref: { module: "../../src/_access-lowering", export: "deriveAnnotations" },
          },
          exposure: "External",
          acceptedCredentials: ["BetterAuthCookie"],
          principalKinds: ["Person"],
          capabilities: { _tag: "None" },
          requirements: [],
          canonicalScopeResolver: {
            _tag: "Symbol",
            ref: { module: "../../src/_access-lowering", export: "resolveScope" },
          },
          concealment: { _tag: "Reveal" },
          decisionTime: "SnapshotRead",
        });

        assert.deepStrictEqual(access, expected);
        const contract = decorated.annotations[2]!.args[0];
        assert.deepStrictEqual(
          contract,
          yield* Schema.decodeEffect(AnnotationArg)({
            group: "access",
            middleware: [
              {
                _tag: "Symbol",
                ref: { module: "../../src/_access-lowering", export: "PersonSecurity" },
                security: true,
              },
              {
                _tag: "Symbol",
                ref: { module: "../../src/contract-support", export: "RequestMarker" },
              },
            ],
          }),
        );

        const invalidArguments = collected.diagnostics.filter(
          (diagnostic) => diagnostic.code === "EFFX1102",
        );

        assert.strictEqual(invalidArguments.length, 2);
        assert.isTrue(
          invalidArguments.some((diagnostic) => diagnostic.message.includes("deriveAnnotations")),
        );
        assert.isTrue(
          invalidArguments.some((diagnostic) => diagnostic.message.includes("hiddenResolver")),
        );
        assert.isUndefined(collected.declarations.find((item) => item.id === "InvalidAccess.read"));
        assert.isUndefined(collected.declarations.find((item) => item.id === "HiddenAccess.read"));
      }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("accepts an explicit strict-access project setting", () =>
    Effect.gen(function* () {
      const config = yield* Schema.decodeEffect(ProjectConfig)({
        tsconfigPath,
        strictAccess: true,
      });

      assert.strictEqual(config.strictAccess, true);
    }),
  );
});
