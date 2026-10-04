import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
} from "effect";
import { Extensions, compile, type TargetProfile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { semanticHash } from "@effx/ir";
import { persistenceExtension } from "@effx/persistence/compiler";
import {
  compoundProgram,
  conformanceProgram,
  equalityDeclarations,
  equalityProgram,
  interruptionProgram,
  liveJourneyProgram,
  misMappedProgram,
  mixedTransactionsProgram,
  nonAtomicProgram,
} from "./acceptance-programs.ts";
import { subprocess } from "./process.ts";

const repoRoot = new URL("../../../", import.meta.url).pathname;

const rc116Roots = [
  `${repoRoot}packages/frontend-ts/test/fixtures/rc116/`,
  new URL("../../../../effx/packages/frontend-ts/test/fixtures/rc116/", import.meta.url).pathname,
];

const EffectPackage = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

const decodeEffectPackage = Schema.decodeEffect(EffectPackage);

const Services = TsSourceFrontend.layer.pipe(Layer.provideMerge(BunServices.layer));

const extensions = [...Extensions.builtin, persistenceExtension];

const Json = Schema.fromJsonString(Schema.Json);

const encodeJson = Schema.encodeEffect(Json);

const quote = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

const Report = Schema.fromJsonString(
  Schema.Struct({
    numTotalTests: Schema.Int,
    numFailedTests: Schema.Int,
    testResults: Schema.Array(
      Schema.Struct({
        assertionResults: Schema.Array(
          Schema.Struct({
            fullName: Schema.String,
            status: Schema.String,
            failureMessages: Schema.Array(Schema.String),
          }),
        ),
      }),
    ),
  }),
);

const decodeReport = Schema.decodeEffect(Report);

const Observation = Schema.fromJsonString(
  Schema.Struct({
    adapter: Schema.String,
    interrupted: Schema.Boolean,
    rolledBack: Schema.Boolean,
    connectionUsable: Schema.Boolean,
    finalizerCompleted: Schema.Boolean,
    snapshotReadable: Schema.Boolean,
    before: Schema.Json,
    after: Schema.Json,
  }),
);

const decodeObservation = Schema.decodeEffect(Observation);

// Reuse the native scoped-process adapter and FileSystem scoped-temp pattern, but never
// use examples/* or packages/*/test/fixtures as an output directory. The scope owns every copy,
// child config, generated file and reporter artifact on success, failure and interruption.
const workspace = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const directory = yield* fs.makeTempDirectoryScoped({
    directory: repoRoot,
    prefix: ".persistence-acceptance-",
  });

  const users = path.join(directory, "examples/users");
  const project = path.join(directory, "examples/persistence");

  const paths = {
    "@effx/runtime": [path.join(repoRoot, "packages/runtime/src/index.ts")],
    "@effx-examples/users/*": [path.join(users, "src/*.ts")],
    "@effx/persistence/syntax": [path.join(repoRoot, "packages/persistence/src/syntax.ts")],
  };

  yield* fs.makeDirectory(users, { recursive: true });
  yield* fs.makeDirectory(project, { recursive: true });
  yield* fs.copy(path.join(repoRoot, "examples/users/src"), path.join(users, "src"));
  yield* fs.copy(path.join(repoRoot, "examples/persistence/src"), path.join(project, "src"));
  yield* fs.writeFileString(
    path.join(directory, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  yield* fs.writeFileString(
    path.join(project, "tsconfig.json"),
    yield* encodeJson({
      extends: path.join(repoRoot, "tsconfig.json"),
      compilerOptions: {
        paths,
      },
      include: ["src/**/*.ts", "../users/src/**/*.ts", ".effx/generated/**/*.ts"],
      exclude: ["src/*-main.ts", "../users/src/*-main.ts", "../users/src/server.ts"],
    }),
  );

  return { directory, project, users, paths, tsconfigPath: path.join(project, "tsconfig.json") };
});

type Workspace = Effect.Success<ReturnType<typeof workspace>>;

const generate = Effect.fnUntraced(function* (
  fixture: Workspace,
  entry: ReadonlyArray<string> = ["src/ports.ts", "../users/src/operations.ts"],
  target: TargetProfile = "effect-4.0",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outDir = path.join(fixture.project, ".effx/generated");

  const result = yield* compile(
    {
      tsconfigPath: fixture.tsconfigPath,
      entry,
      outDir,
      target,
      projectRoot: path.join(fixture.directory, "examples"),
    },
    extensions,
  );

  assert.deepStrictEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    [],
  );
  const files = Option.getOrThrow(result.files.value);
  assert.isTrue(files.some((file) => file.path === "users-port.ts"));
  assert.isTrue(files.some((file) => file.path === "users-conformance.ts"));
  yield* fs.makeDirectory(outDir, { recursive: true });

  for (const file of files) {
    yield* fs.writeFileString(path.join(outDir, file.path), file.contents);
  }

  return { files, hash: yield* semanticHash(Option.getOrThrow(result.ir.value)) };
});

const typecheck = Effect.fnUntraced(function* (fixture: Workspace, config = fixture.tsconfigPath) {
  return yield* subprocess(
    ["bun", "--bun", `${repoRoot}node_modules/.bin/tsc`, "--noEmit", "-p", config],
    fixture.project,
  );
});

const suite = Effect.fnUntraced(function* (fixture: Workspace, name: string, program: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const test = path.join(fixture.project, `${name}.acceptance.test.ts`);
  const config = path.join(fixture.directory, "vitest.config.ts");
  const reportFile = path.join(fixture.directory, `${name}.json`);
  yield* fs.writeFileString(test, program);
  // Reuse the TC39 transform and workspace aliases; do not inherit the root test projects.
  yield* fs.writeFileString(
    config,
    `import { defineConfig } from "vitest/config";
import base from "../vitest.config.ts";
export default defineConfig({
  plugins: base.plugins,
  root: ${yield* quote(fixture.project)},
  cacheDir: ${yield* quote(path.join(fixture.directory, "vite-cache"))},
  test: {
    silent: false,
    alias: {
      ...base.test.alias,
      "@effx-examples/users/schemas": ${yield* quote(path.join(fixture.users, "src/schemas.ts"))},
      "@effx-examples/users/user": ${yield* quote(path.join(fixture.users, "src/user.ts"))},
      "@effx-examples/users/services": ${yield* quote(path.join(fixture.users, "src/services.ts"))},
    },
    include: [${yield* quote(test)}],
    exclude: [],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120000,
    reporters: ["verbose", "json"],
    outputFile: ${yield* quote(reportFile)},
  },
});\n`,
  );

  const result = yield* subprocess(
    ["bun", "--bun", `${repoRoot}node_modules/.bin/vitest`, "run", "--config", config],
    fixture.project,
  );

  assert.isTrue(yield* fs.exists(reportFile), result.text);
  const report = yield* fs.readFileString(reportFile).pipe(Effect.flatMap(decodeReport));
  // A loading error or an empty collection is never evidence that a property rejected an adapter.
  assert.isAbove(report.numTotalTests, 0, result.text);
  yield* Effect.log(
    "spec 0022 generated suite evidence",
    yield* encodeJson({
      mode: name,
      exitCode: result.code,
      tests: report.numTotalTests,
      failures: report.testResults.flatMap((file) =>
        file.assertionResults.flatMap((test) =>
          test.status === "failed"
            ? [{ property: test.fullName, messages: test.failureMessages }]
            : [],
        ),
      ),
    }),
  );

  return { ...result, report };
});

const replaceOnce = (source: string, before: string, after: string): string => {
  assert.strictEqual(source.split(before).length, 2, `mutation needs exactly one match: ${before}`);

  return source.replace(before, after);
};

const assertAdapterDiagnostics = (output: string, method: string, reason: RegExp): void => {
  const diagnostics = output.split(/\n(?=[^\n]*\.ts\(\d+,\d+\): error TS)/);

  for (const adapter of ["UsersSql.ts", "UsersDrizzle.ts"]) {
    const diagnostic = diagnostics.find((block) => block.includes(adapter));
    assert.isDefined(diagnostic, output);
    assert.include(diagnostic!, method);
    assert.match(diagnostic!, reason);
  }
};

const addedMethod = `
export const ExtraUser = Operation.query({ name: "Users.extra", input: GetUserInput, success: User })
  .errors(UserNotFound)
  .with(Persist.Port({ port: "Users" }))
  .declare();
`;

const missingMethodScenario = `
import type { SqlClient, SqlError } from "effect/sql";
import type { UsersScenarios } from "./.effx/generated/users-conformance.ts";
import { sharedUsersScenarios } from "./src/scenarios.ts";
const invalid: UsersScenarios<SqlError.SqlError, SqlClient.SqlClient> = {
  ...sharedUsersScenarios,
  methods: { ...sharedUsersScenarios.methods, absent: sharedUsersScenarios.methods.find },
};
export { invalid };
`;

const undeclaredErrorScenario = `
import type { SqlClient, SqlError } from "effect/sql";
import { UserId } from "@effx-examples/users/schemas";
import { Schema } from "effect";
import type { UsersScenarios } from "./.effx/generated/users-conformance.ts";
import { sharedUsersScenarios } from "./src/scenarios.ts";
class Undeclared extends Schema.TaggedError<Undeclared>()("Undeclared", {}) {}
const invalid: UsersScenarios<SqlError.SqlError, SqlClient.SqlClient> = {
  ...sharedUsersScenarios,
  methods: {
    ...sharedUsersScenarios.methods,
    find: {
      ...sharedUsersScenarios.methods.find,
      errors: {
        UserNotFound: [{ name: "undeclared", input: { id: UserId.make("missing") }, expected: new Undeclared() }],
      },
    },
  },
};
export { invalid };
`;

describe("spec 0022 subprocess custody", () => {
  it.live("retains real child success, nonzero exit and typed spawn failure", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const directory = yield* fs.makeTempDirectoryScoped({
        directory: repoRoot,
        prefix: ".persistence-process-",
      });

      const success = yield* subprocess(
        [
          "bun",
          "-e",
          'import { Effect } from "effect"; Effect.runSync(Effect.log("child-success"));',
        ],
        directory,
      );

      assert.strictEqual(success.code, 0, success.text);
      assert.include(success.text, "child-success");

      const failure = yield* subprocess(
        [
          "bun",
          "-e",
          'import { BunRuntime } from "@effect/platform-bun"; import { Effect } from "effect"; BunRuntime.runMain(Effect.die("child-defect"));',
        ],
        directory,
      );

      assert.notStrictEqual(failure.code, 0, failure.text);
      assert.include(failure.text, "child-defect");

      const unavailable = yield* Effect.flip(
        subprocess([path.join(directory, "missing-executable")], directory),
      );

      assert.strictEqual(unavailable._tag, "PlatformError");

      if (unavailable._tag === "PlatformError")
        assert.strictEqual(unavailable.reason._tag, "NotFound");
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("streams readiness and awaits real child cleanup on caller interruption", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const directory = yield* fs.makeTempDirectoryScoped({
        directory: repoRoot,
        prefix: ".persistence-process-",
      });

      const script = path.join(directory, "child.ts");
      const released = path.join(directory, "released.txt");
      yield* fs.writeFileString(
        script,
        `
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem } from "effect";
BunRuntime.runMain(Effect.scoped(Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.acquireRelease(
    Effect.log("child-resource-ready"),
    () => fs.writeFileString(${yield* quote(released)}, "released-once").pipe(Effect.orDie),
  );
  yield* Effect.never;
})).pipe(Effect.provide(BunServices.layer)));
`,
      );
      const ready = yield* Deferred.make<void>();

      const fiber = yield* Effect.forkChild(
        subprocess(["bun", script], directory, (line) =>
          line.includes("child-resource-ready")
            ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid)
            : Effect.void,
        ),
      );

      // Without streaming output this milestone cannot arrive while the child is still running.
      yield* Deferred.await(ready);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.isFailure(exit));

      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
      // Without scoped process ownership the signal never reaches the real child finalizer.
      assert.strictEqual(yield* fs.readFileString(released), "released-once");
    }).pipe(Effect.provide(BunServices.layer)),
  );
});

// Every test below defends a frozen §6 falsifier, using the generated suite itself for properties.
describe("spec 0022 executable acceptance", () => {
  it.effect(
    "rejects a real decorated local-bodied port method through the TypeScript frontend",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* workspace();

        yield* fs.writeFileString(
          path.join(fixture.project, "src/decorated-local-port.ts"),
          `import { Query } from "@effx/runtime";
import { Persist } from "@effx/persistence/syntax";
import { Effect } from "effect";
import { GetUserInput, UserNotFound } from "@effx-examples/users/schemas";
import { User } from "@effx-examples/users/user";

export class LocalUsers {
  @Query({ name: "Users.find", input: GetUserInput, success: User })
  @Persist.Port({ port: "Users" })
  static find(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      if (input.id === "missing") return yield* new UserNotFound({ id: input.id });
      return new User({ id: input.id, email: "local@example.com", displayName: "Local" });
    });
  }
}
`,
        );

        const result = yield* compile(
          {
            tsconfigPath: fixture.tsconfigPath,
            entry: ["src/decorated-local-port.ts"],
            projectRoot: path.join(fixture.directory, "examples"),
            outDir: path.join(fixture.project, ".effx/generated"),
          },
          extensions,
        );

        const rejection = result.diagnostics.find((diagnostic) => diagnostic.code === "EFFX3401");
        assert.isDefined(
          rejection,
          result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
        );
        assert.strictEqual(rejection!.severity, "error");
        assert.isTrue(Option.isSome(result.collected.value));
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.live(
    "both fresh PGlite adapters pass generated G1-G4 and shared typed unique scenarios",
    () =>
      Effect.gen(function* () {
        const fixture = yield* workspace();
        yield* generate(fixture);
        const result = yield* suite(fixture, "conformance", conformanceProgram);
        assert.strictEqual(result.code, 0, result.text);
        assert.strictEqual(result.report.numFailedTests, 0);

        const names = result.report.testResults.flatMap((file) =>
          file.assertionResults.map((test) => test.fullName),
        );

        for (const property of ["G1", "G2", "G3", "G4", "setEmail.EmailTaken"]) {
          assert.isTrue(
            names.some((name) => name.includes(property)),
            `unexercised ${property}`,
          );
        }
      }).pipe(Effect.provide(Services)),
    180_000,
  );

  it.live(
    "the unchanged users live HTTP and RPC journey runs on both persistence adapters",
    () =>
      Effect.gen(function* () {
        const fixture = yield* workspace();
        yield* generate(fixture);
        const result = yield* suite(fixture, "live", liveJourneyProgram);
        assert.strictEqual(result.code, 0, result.text);
        assert.strictEqual(result.report.numTotalTests, 2);
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.live(
    "mixed adapter calls commit and roll back in one real shared transaction",
    () =>
      Effect.gen(function* () {
        const fixture = yield* workspace();
        yield* generate(fixture);
        const result = yield* suite(fixture, "mixed", mixedTransactionsProgram);
        assert.strictEqual(result.code, 0, result.text);
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.live(
    "records interruption outcomes without asserting rollback or usability in advance",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* workspace();
        yield* generate(fixture);
        const result = yield* suite(fixture, "interruption", interruptionProgram);
        assert.strictEqual(result.code, 0, result.text);

        for (const adapter of ["sql", "drizzle"]) {
          const record = yield* fs
            .readFileString(path.join(fixture.project, `interruption-${adapter}.json`))
            .pipe(Effect.flatMap(decodeObservation));

          yield* Effect.log("spec 0022 interruption evidence", yield* encodeJson(record));
        }
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "switching an imported composition-root adapter preserves semantic hash and every byte",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* workspace();
        const root = path.join(fixture.project, "src/adapter-choice.ts");
        const entry = ["src/ports.ts", "../users/src/operations.ts", "src/adapter-choice.ts"];
        yield* fs.writeFileString(root, 'export { UsersSql as selected } from "./UsersSql.ts";\n');
        const sql = yield* generate(fixture, entry);
        yield* fs.writeFileString(
          root,
          'export { UsersDrizzle as selected } from "./UsersDrizzle.ts";\n',
        );
        const drizzle = yield* generate(fixture, entry);
        assert.strictEqual(sql.hash, drizzle.hash);
        assert.deepStrictEqual(sql.files, drizzle.files);
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.live(
    "adding and deleting declarations rejects both unchanged adapter literals",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* workspace();
        yield* generate(fixture);
        const baseline = yield* typecheck(fixture);
        assert.strictEqual(baseline.code, 0, baseline.text);
        const declarations = path.join(fixture.project, "src/ports.ts");
        const original = yield* fs.readFileString(declarations);
        yield* fs.writeFileString(declarations, original + addedMethod);
        yield* generate(fixture);
        const added = yield* typecheck(fixture);
        assert.notStrictEqual(added.code, 0, added.text);
        assertAdapterDiagnostics(added.text, "extra", /missing/);
        assert.include(added.text, "extra");
        const withoutFind = original.replace(/export const FindUser = [\s\S]*?\.declare\(\);/, "");
        assert.notStrictEqual(withoutFind, original);
        yield* fs.writeFileString(declarations, withoutFind);
        yield* generate(fixture);
        const deleted = yield* typecheck(fixture);
        assert.notStrictEqual(deleted.code, 0, deleted.text);
        assertAdapterDiagnostics(deleted.text, "find", /known properties|does not exist/);
        assert.include(deleted.text, "find");
      }).pipe(Effect.provide(Services)),
    180_000,
  );

  it.live(
    "missing-method and undeclared-error domain scenarios fail the generated scenario types",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* workspace();
        yield* generate(fixture);
        const baseline = yield* typecheck(fixture);
        assert.strictEqual(baseline.code, 0, baseline.text);
        const invalid = path.join(fixture.project, "scenario-negative.ts");
        const config = path.join(fixture.project, "tsconfig.negative.json");
        yield* fs.writeFileString(
          config,
          yield* encodeJson({
            extends: "./tsconfig.json",
            include: ["scenario-negative.ts"],
          }),
        );

        for (const [source, expected] of [
          [missingMethodScenario, "absent"],
          [undeclaredErrorScenario, "Undeclared"],
        ] as const) {
          yield* fs.writeFileString(invalid, source);
          const result = yield* typecheck(fixture, config);
          assert.notStrictEqual(result.code, 0, result.text);
          assert.match(result.text, /scenario-negative\.ts\(\d+,\d+\): error TS/);
          assert.include(result.text, expected);
        }
      }).pipe(Effect.provide(Services)),
    180_000,
  );

  it.live(
    "the generated properties reject the deliberately non-atomic adapter by name",
    () =>
      Effect.gen(function* () {
        const fixture = yield* workspace();
        yield* generate(fixture);
        const result = yield* suite(fixture, "non-atomic", nonAtomicProgram);
        assert.notStrictEqual(result.code, 0, result.text);

        const failures = result.report.testResults.flatMap((file) =>
          file.assertionResults.filter((test) => test.status === "failed"),
        );

        assert.isTrue(
          failures.some((test) => test.fullName.includes("G3 rollback successful command")),
          result.text,
        );
        assert.isTrue(
          failures.some((test) => test.fullName.includes("G4 shared transaction rollback")),
          result.text,
        );
        assert.isTrue(failures.every((test) => test.failureMessages.length > 0));
      }).pipe(Effect.provide(Services)),
    180_000,
  );

  it.live(
    "the generated G1 unique-error scenario rejects an actual SQL defect mapping",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* workspace();
        yield* generate(fixture);
        const sqlAdapter = path.join(fixture.project, "src/UsersSql.ts");
        const source = yield* fs.readFileString(sqlAdapter);
        yield* fs.writeFileString(
          sqlAdapter,
          replaceOnce(
            source,
            "Effect.fail(new EmailTaken({ email: input.email }))",
            "Effect.die(reason)",
          ),
        );
        const result = yield* suite(fixture, "mis-mapped", misMappedProgram);
        assert.notStrictEqual(result.code, 0, result.text);

        const failures = result.report.testResults.flatMap((file) =>
          file.assertionResults.filter((test) => test.status === "failed"),
        );

        assert.isTrue(
          failures.some((test) => test.fullName.includes("G1 domain error: setEmail.EmailTaken")),
          result.text,
        );
        assert.isTrue(failures.every((test) => test.failureMessages.length > 0));
      }).pipe(Effect.provide(Services)),
    180_000,
  );

  it.live(
    "G2 and domain scenarios reject unequal Type values hidden by identical encodings",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* workspace();
        yield* fs.writeFileString(
          path.join(fixture.project, "src/equality.ts"),
          equalityDeclarations,
        );
        yield* generate(fixture, ["src/ports.ts", "src/equality.ts"]);
        const result = yield* suite(fixture, "equality", equalityProgram);
        assert.notStrictEqual(result.code, 0, result.text);
        const tests = result.report.testResults.flatMap((file) => file.assertionResults);
        const failures = tests.filter((test) => test.status === "failed");
        assert.strictEqual(failures.length, 5, result.text);

        for (const method of ["success", "failure"]) {
          assert.isTrue(
            failures.some(
              (test) =>
                test.fullName.includes("changing") &&
                test.fullName.includes("G2 query purity: " + method),
            ),
            result.text,
          );
        }

        const wrongExpected = failures.filter((test) => test.fullName.includes("wrong-expected"));
        assert.strictEqual(wrongExpected.length, 3, result.text);
        assert.isTrue(
          wrongExpected.every((test) => test.fullName.includes("G1 domain")),
          result.text,
        );

        const stable = tests.filter((test) => test.fullName.includes("stable"));
        assert.isAbove(stable.length, 0);
        assert.isTrue(
          stable.every((test) => test.status === "passed"),
          result.text,
        );
        assert.isTrue(
          tests.some(
            (test) =>
              test.fullName.includes("distinct Type values collapse") && test.status === "passed",
          ),
          result.text,
        );
      }).pipe(Effect.provide(Services)),
    180_000,
  );

  it.live(
    "generated G1 accepts every declared Fail and G2 compares unordered failure multisets",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* workspace();
        yield* fs.writeFileString(
          path.join(fixture.project, "src/equality.ts"),
          equalityDeclarations,
        );
        yield* generate(fixture, ["src/ports.ts", "src/equality.ts"]);
        const result = yield* suite(fixture, "compound", compoundProgram);
        assert.notStrictEqual(result.code, 0, result.text);
        const tests = result.report.testResults.flatMap((file) => file.assertionResults);
        const failures = tests.filter((test) => test.status === "failed");
        const valid = tests.filter((test) => test.fullName.includes(" / reversed "));
        assert.isAbove(valid.length, 0);
        assert.isTrue(
          valid.every((test) => test.status === "passed"),
          result.text,
        );

        for (const mode of ["changed-member", "changed-multiplicity", "changed-length"]) {
          const named = tests.filter((test) => test.fullName.includes(" / " + mode + " "));
          const rejected = named.filter((test) => test.status === "failed");
          assert.strictEqual(rejected.length, 1, result.text);
          assert.include(rejected[0]!.fullName, "G2 query purity: probe");
        }

        for (const mode of ["mixed-defect", "mixed-interrupt", "undeclared"]) {
          const rejected = failures.filter((test) => test.fullName.includes(" / " + mode + " "));
          assert.strictEqual(rejected.length, 2, result.text);
          assert.isTrue(
            rejected.some((test) => test.fullName.includes("G1 closed error channel: probe")),
            result.text,
          );
          assert.isTrue(
            rejected.some((test) => test.fullName.includes("G2 query purity: probe")),
            result.text,
          );
        }

        const domain = failures.filter((test) => test.fullName.includes(" / compound-domain "));
        assert.strictEqual(domain.length, 1, result.text);
        assert.include(domain[0]!.fullName, "G1 domain error: probe.ProbeError");
        const rollback = failures.filter((test) => test.fullName.includes(" / compound-rollback "));
        assert.strictEqual(rollback.length, 2, result.text);
        assert.isTrue(
          rollback.every((test) => test.fullName.includes("G3 rollback")),
          result.text,
        );
        assert.strictEqual(failures.length, 12, result.text);
      }).pipe(Effect.provide(Services)),
    180_000,
  );

  it.live(
    "generated ports typecheck against stable and installed rc.116 through target mapping",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        let rc116Root: string | undefined;

        for (const candidate of rc116Roots) {
          const packageFile = path.join(candidate, "node_modules/effect/package.json");

          if (!(yield* fs.exists(packageFile))) continue;

          const installed = yield* fs
            .readFileString(packageFile)
            .pipe(Effect.flatMap(decodeEffectPackage));

          if (installed.version === "4.0.0-rc.116") {
            rc116Root = candidate;
            break;
          }
        }

        if (rc116Root === undefined)
          return yield* Effect.die(
            "install rc.116 dependencies with the fixture frozen lock before acceptance; source fixture paths remain read-only",
          );

        for (const target of ["effect-4.0", "effect-4.0-rc"] as const) {
          const fixture = yield* workspace();

          const generated = yield* generate(fixture, ["src/ports.ts"], target);
          const port = generated.files.find((file) => file.path === "users-port.ts");
          assert.isDefined(port);
          const config = path.join(fixture.project, "tsconfig.port.json");
          yield* fs.writeFileString(
            config,
            yield* encodeJson({
              extends: "./tsconfig.json",
              compilerOptions: {
                paths: {
                  ...fixture.paths,
                  // Apply one installed family to app schemas and parent-root runtime sources alike.
                  // A temp node_modules symlink cannot redirect imports beside the runtime sources.
                  effect: [
                    path.join(
                      target === "effect-4.0-rc" ? rc116Root : repoRoot,
                      "node_modules/effect/dist/index.d.ts",
                    ),
                  ],
                  "effect/*": [
                    path.join(
                      target === "effect-4.0-rc" ? rc116Root : repoRoot,
                      "node_modules/effect/dist/*.d.ts",
                    ),
                  ],
                },
              },
              include: [".effx/generated/users-port.ts"],
            }),
          );
          const result = yield* typecheck(fixture, config);
          assert.strictEqual(result.code, 0, result.text);
        }
      }).pipe(Effect.provide(Services)),
    180_000,
  );
});
