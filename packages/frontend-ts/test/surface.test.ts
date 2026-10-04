import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import {
  Extensions,
  type GeneratedSource,
  checkWiring,
  compile,
  SurfaceJson,
  surfaceOf,
  surfaceText,
} from "@effx/compiler";
import { TsSourceFrontend, Wiring } from "@effx/frontend-ts";
import { semanticHash } from "@effx/ir";
import { requireRc116FixtureDependencies } from "./rc116-fixture-dependencies.ts";

/*
 * Spec 0021 falsifiers 1, 2 and 5 over the isolated Effect rc.116 Profile twin: the external
 * group's surface, its mode independence, and the handlers-mode wiring check.
 */

const fixtures = new URL("./fixtures/rc116/", import.meta.url).pathname;

requireRc116FixtureDependencies(fixtures);

const contractConfig = `${fixtures}project/contract/tsconfig.effx.json`;

const handlersConfig = `${fixtures}project/typecheck-handlers/tsconfig.effx.json`;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const profile = Effect.fn("profile")(function* (config: string, emit: "contract" | "handlers") {
  const result = yield* compile(
    { tsconfigPath: config, entry: ["../../src/profile.effx.ts"], emit, strictAccess: true },
    Extensions.builtin,
  );

  assert.deepStrictEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    [],
  );

  const ir = Option.getOrThrow(result.ir.value);
  const index = Option.getOrThrow(result.index);
  const files = Option.getOrThrow(result.files.value);
  const collected = Option.getOrThrow(result.collected.value);
  const surface = yield* surfaceOf(ir, index, yield* semanticHash(ir));

  return { surface, files, outputDir: collected.project?.outputDir ?? "" };
});

const wiring = Effect.fn("wiring")(function* (
  config: string,
  emit: "contract" | "handlers",
  entry: string,
) {
  const built = yield* profile(config, emit);

  const generated: ReadonlyArray<GeneratedSource> = built.files.map((file) => ({
    path: `${built.outputDir}/${file.path}`,
    contents: file.contents,
  }));

  const facts = yield* Wiring.analyzeWiring({
    tsconfigPath: config,
    entry,
    generatedDir: built.outputDir,
    overlay: generated,
  });

  return checkWiring({ surface: built.surface, generated, facts, entry });
});

describe("surface manifest over the rc.116 Profile twin (spec 0021)", () => {
  it.effect("is byte-identical for contract and handlers emit and lists the external group", () =>
    Effect.gen(function* () {
      const contract = yield* profile(contractConfig, "contract");
      const handlers = yield* profile(handlersConfig, "handlers");
      assert.strictEqual(surfaceText(contract.surface), surfaceText(handlers.surface));

      const decoded = yield* Schema.decodeEffect(SurfaceJson)(surfaceText(handlers.surface));
      assert.deepStrictEqual(decoded, handlers.surface);

      assert.deepStrictEqual(
        handlers.surface.http.map((group) => [
          group.root,
          group.group,
          group.binding,
          group.wiring,
        ]),
        [["external-native-api", "profile", "external", "ProfileApiHandlers"]],
      );

      const endpoints = handlers.surface.http.flatMap((group) => group.endpoints);
      assert.isAbove(endpoints.length, 0);

      for (const endpoint of endpoints) {
        assert.isDefined(
          endpoint.access,
          `${endpoint.operation} must carry its access declaration`,
        );
        assert.include(["SnapshotRead", "Transaction"], endpoint.access?.decisionTime);
        assert.isAbove(endpoint.security.length, 0, `${endpoint.operation} security markers`);
      }

      assert.isTrue(
        handlers.surface.operations.every((operation) => operation.binding === "external"),
      );
    }).pipe(Effect.provide(Services)),
  );

  it.effect(
    "handlers emit: a program wiring ProfileApiHandlers passes; omitting it is EFFX2802",
    () =>
      Effect.gen(function* () {
        const wired = yield* wiring(
          handlersConfig,
          "handlers",
          `${fixtures}wiring/profile-worker.ts`,
        );

        assert.deepStrictEqual(
          wired.filter((diagnostic) => diagnostic.severity !== "info"),
          [],
        );

        const missing = yield* wiring(
          handlersConfig,
          "handlers",
          `${fixtures}wiring/profile-worker-missing.ts`,
        );

        assert.deepStrictEqual(
          missing.map((diagnostic) => diagnostic.code),
          ["EFFX2802"],
        );

        assert.include(missing[0]?.message ?? "", "ProfileApiHandlers");
      }).pipe(Effect.provide(Services)),
  );

  it.effect("contract emit generates no wiring exports (EFFX2807)", () =>
    Effect.gen(function* () {
      const contract = yield* wiring(
        contractConfig,
        "contract",
        `${fixtures}wiring/profile-worker-missing.ts`,
      );

      assert.deepStrictEqual(
        contract.map((diagnostic) => [diagnostic.code, diagnostic.severity]),
        [["EFFX2807", "info"]],
      );
    }).pipe(Effect.provide(Services)),
  );
});
