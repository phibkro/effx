/**
 * Spec 0020 falsifier harness: snapshots everything the pipeline derives from a source project so two
 * revisions of the compiler can be compared byte-for-byte: Collected, every diagnostic (code, severity,
 * message, location), the canonical IR, its semantic hash and the SHA-256 of every generated file.
 *
 *   bun scripts/identity-snapshot.ts <out.json> [extra-cases.json] [--extras-only]
 *
 * Built-in cases cover the users fixture entries, the rc116 split projects and `examples/users`.
 * `extra-cases.json` is `[{ name, tsconfigPath, entry?, emit?, target?, strictAccess? }]` (the mono-web
 * baseline declarations are built this way through a throwaway tsconfig).
 */
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, FileSystem, Layer, Path, Schema, Stdio } from "effect";
import {
  type Collected,
  type Diagnostic,
  type ProjectConfig,
  Extensions,
  compile,
} from "@effx/compiler";
import { canonical, semanticHash } from "@effx/ir";
import { TsSourceFrontend } from "@effx/frontend-ts";

interface Case extends ProjectConfig {
  readonly name: string;
}

const root = new URL("../", import.meta.url).pathname;

const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

const discover = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cases: Array<Case> = [];

  const users = path.join(root, "packages/frontend-ts/test/fixtures/users");

  for (const file of (yield* fs.readDirectory(path.join(users, "src"))).toSorted()) {
    if (!file.endsWith(".ts")) continue;
    cases.push({
      name: `users/${file}`,
      tsconfigPath: path.join(users, "tsconfig.json"),
      entry: [`src/${file}`],
      strictAccess: false,
    });
  }

  const rc = path.join(root, "packages/frontend-ts/test/fixtures/rc116");

  for (const project of ["contract", "handlers", "content-handlers"]) {
    const tsconfigPath = path.join(rc, "project", project, "tsconfig.effx.json");

    if (!(yield* fs.exists(tsconfigPath))) continue;

    for (const file of (yield* fs.readDirectory(path.join(rc, "src"))).toSorted()) {
      if (!file.endsWith(".effx.ts")) continue;

      for (const emit of ["contract", "handlers"] as const) {
        cases.push({
          name: `rc116/${project}/${file}/${emit}`,
          tsconfigPath,
          entry: [`../../src/${file}`],
          emit,
          strictAccess: true,
        });
      }
    }
  }

  cases.push({
    name: "examples/users",
    tsconfigPath: path.join(root, "examples/users/tsconfig.json"),
  });

  return cases;
});

/** Execution-only resolvers capture the frontend Program and are already omitted by JSON. */
export const collectedSnapshot = (
  collected: Collected,
): Omit<Collected, "resolveEffectModule" | "resolveHttpApiInventory"> => {
  const { resolveEffectModule: _modules, resolveHttpApiInventory: _inventory, ...data } = collected;

  return data;
};

const snapshot = (project: Case) =>
  Effect.gen(function* () {
    const { name: _name, ...config } = project;
    const result = yield* compile(config, Extensions.builtin);
    const ir = result.ir.value._tag === "Some" ? result.ir.value.value : undefined;
    const hash = ir === undefined ? null : yield* semanticHash(ir);

    return {
      collected:
        result.collected.value._tag === "Some"
          ? collectedSnapshot(result.collected.value.value)
          : null,
      diagnostics: result.diagnostics,
      canonical: ir === undefined ? null : canonical(ir),
      hash,
      files:
        result.files.value._tag === "Some"
          ? Object.fromEntries(
              result.files.value.value.map((file) => [file.path, sha256(file.contents)]),
            )
          : null,
    };
  }).pipe(Effect.catch((fault) => Effect.succeed({ fault: String(fault) })));

/** Everything the pipeline derived from one project; stages that produced nothing are `null`. */
interface Derived {
  readonly collected: Collected | null;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly canonical: string | null;
  readonly hash: string | null;
  readonly files: Readonly<Record<string, string>> | null;
}

/** A project whose compilation failed outright (`CompilerFault`). */
interface Faulted {
  readonly fault: string;
}

type Snapshot = Derived | Faulted;

const ExtraCases = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      tsconfigPath: Schema.String,
      entry: Schema.optionalKey(Schema.Array(Schema.String)),
      emit: Schema.optionalKey(Schema.Literals(["contract", "handlers", "all"])),
      target: Schema.optionalKey(Schema.Literals(["effect-4.0", "effect-4.0-rc"])),
      strictAccess: Schema.optionalKey(Schema.Boolean),
      projectRoot: Schema.optionalKey(Schema.String),
    }),
  ),
);

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const stdio = yield* Stdio.Stdio;
  const args = yield* stdio.args;
  const argv = args.filter((arg) => arg !== "--extras-only");
  const extrasOnly = args.includes("--extras-only");
  const [out, extra] = argv;

  if (out === undefined)
    return yield* Effect.die("usage: identity-snapshot.ts <out.json> [extra.json]");

  const cases = extrasOnly ? [] : [...(yield* discover)];

  if (extra !== undefined) {
    const decoded = yield* Schema.decodeEffect(ExtraCases)(yield* fs.readFileString(extra));

    cases.push(...decoded);
  }

  const results: Record<string, Snapshot> = {};

  for (const project of cases) {
    results[project.name] = yield* snapshot(project);
    yield* Console.error(`snapshot ${project.name}`);
  }

  yield* fs.writeFileString(out, JSON.stringify(results, null, 1));
});

if (import.meta.main) await Effect.runPromise(program.pipe(Effect.provide(Services)));
