import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { LiftJsonReport } from "@effx/cli";
import { liftCheckExecutionLayer } from "../lift-execution.ts";
import { digestTree } from "../../tools/testing/projects.ts";
import { api, miniFiles, miniProject, runCli, writeProject } from "./lift-fixtures.ts";

const services = liftCheckExecutionLayer.pipe(Layer.provideMerge(BunServices.layer));

const decodeReport = Schema.decodeUnknownEffect(LiftJsonReport);

const lift = (cwd: string, ...flags: ReadonlyArray<string>) =>
  runCli(cwd, ["lift", "--group", "profile", "--module", "src/profile.effx.ts", ...flags]);

describe("effx lift through the installed-style process root (spec 0019 §4)", () => {
  it.live(
    "prints one report on stdout and writes nothing by default",
    () =>
      Effect.gen(function* () {
        const fixture = yield* miniProject;
        const before = yield* digestTree(fixture.directory);
        const report = yield* lift(fixture.directory);

        assert.strictEqual(report.code, 0, `${report.stdout}\n${report.stderr}`);
        assert.include(report.stdout, "SUGGESTION (verbose)");
        assert.include(report.stdout, "SUGGESTION (dense)");
        assert.include(report.stdout, "Operation.query");
        assert.notInclude(report.stdout, "CHECK");
        assert.deepStrictEqual(yield* digestTree(fixture.directory), before);
      }).pipe(Effect.scoped, Effect.provide(services)),
    600_000,
  );

  it.live(
    "renders the same printer bytes on stdout, --json and --write, and never overwrites",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* miniProject;

        const json = yield* lift(fixture.directory, "--form", "verbose", "--json");

        assert.strictEqual(json.code, 0, `${json.stdout}\n${json.stderr}`);
        assert.strictEqual(json.stdout.trimEnd().split("\n").length, 1);

        const report = yield* decodeReport(json.stdout.trimEnd());
        const [verbose] = report.suggestions;

        assert.strictEqual(report.form, "verbose");
        assert.strictEqual(report.suggestions.length, 1);
        assert.isUndefined(report.check);
        assert.isDefined(verbose);

        const human = yield* lift(fixture.directory, "--form", "verbose");

        assert.include(human.stdout, verbose ?? "unreachable");

        const target = path.join(fixture.directory, "src/profile.effx.ts");

        const written = yield* lift(fixture.directory, "--form", "verbose", "--write", target);

        assert.strictEqual(written.code, 0, `${written.stdout}\n${written.stderr}`);
        assert.strictEqual(yield* fs.readFileString(target), verbose);

        // A second write refuses before changing a single byte of the existing file.
        const refused = yield* lift(fixture.directory, "--form", "verbose", "--write", target);

        assert.strictEqual(refused.code, 1);
        assert.include(refused.stderr, "exists");
        assert.strictEqual(yield* fs.readFileString(target), verbose);

        // One file needs one form: `both` is a usage error and creates nothing.
        const other = path.join(fixture.directory, "src/other.effx.ts");
        const both = yield* lift(fixture.directory, "--write", other);

        assert.strictEqual(both.code, 1);
        assert.include(both.stderr, "--write writes one file");
        assert.isFalse(yield* fs.exists(other));
      }).pipe(Effect.scoped, Effect.provide(services)),
    600_000,
  );

  it.live(
    "prints the refactor patch and leaves the analyzed source untouched",
    () =>
      Effect.gen(function* () {
        const inline = api
          .replace(
            "{ query: ProfileQuery,",
            "{ query: Schema.Struct({ expand: Schema.optionalKey(Schema.String) }),",
          )
          .replace("ProfilePatch, ProfileQuery, ProfileResponse", "ProfilePatch, ProfileResponse");

        const fixture = yield* writeProject({ ...miniFiles, "src/api.ts": inline }, ["src/api.ts"]);
        const before = yield* digestTree(fixture.directory);
        const patch = yield* lift(fixture.directory, "--form", "verbose", "--emit-patch");

        // A refactor-required lift prints its suggestion and the patch, then exits 1: EFFX3002 is an error
        // diagnostic (spec 0019 §6) because the source needs the edit that nothing here applies.
        assert.strictEqual(patch.code, 1, `${patch.stdout}\n${patch.stderr}`);
        assert.include(patch.stdout, "REFACTOR PATCH");
        assert.include(patch.stdout, "EFFX3002");
        assert.include(patch.stdout, "@@");
        assert.include(patch.stdout, "src/api.ts");
        assert.deepStrictEqual(yield* digestTree(fixture.directory), before);
      }).pipe(Effect.scoped, Effect.provide(services)),
    600_000,
  );

  it.live(
    "checks both forms and the binding gate through the packed-style journey, in text and JSON",
    () =>
      Effect.gen(function* () {
        const fixture = yield* miniProject;
        const before = yield* digestTree(fixture.directory);
        const text = yield* lift(fixture.directory, "--check", "--form", "both");

        assert.strictEqual(text.code, 0, `${text.stdout}\n${text.stderr}`);
        assert.include(text.stdout, "CHECK");
        assert.include(text.stdout, "verbose: PASS");
        assert.include(text.stdout, "dense: PASS");
        assert.include(text.stdout, "binding: PASSED");

        const json = yield* lift(fixture.directory, "--check", "--form", "both", "--json");

        assert.strictEqual(json.code, 0, `${json.stdout}\n${json.stderr}`);

        const report = yield* decodeReport(json.stdout.trimEnd());

        assert.strictEqual(report.check?.verbose?._tag, "Pass");
        assert.strictEqual(report.check?.dense?._tag, "Pass");
        assert.strictEqual(report.check?.binding._tag, "Passed");
        assert.strictEqual(report.suggestions.length, 2);
        assert.deepStrictEqual(yield* digestTree(fixture.directory), before);
      }).pipe(Effect.scoped, Effect.provide(services)),
    900_000,
  );

  it.live(
    "exits 2 when the check does not pass and 1 for an unknown group or a missing module",
    () =>
      Effect.gen(function* () {
        const failing = yield* writeProject(
          {
            ...miniFiles,
            "src/api.ts": api
              .replace(
                "export class ProfileGroup",
                'export const RemoveOwnProfile = HttpApiEndpoint.delete("removeOwnProfile", "/profile", { success: ProfileResponse });\nexport class ProfileGroup',
              )
              .replace(
                ".add(ReadOwnProfile, UpdateOwnProfile)",
                ".add(ReadOwnProfile, UpdateOwnProfile, RemoveOwnProfile)",
              ),
          },
          ["src/api.ts"],
        );

        const failed = yield* lift(failing.directory, "--check", "--form", "verbose");

        assert.strictEqual(failed.code, 2, `${failed.stdout}\n${failed.stderr}`);
        assert.include(failed.stdout, "verbose: FAIL");
        assert.include(failed.stdout, "binding: FAILED");

        const project = yield* miniProject;

        const unknown = yield* runCli(project.directory, [
          "lift",
          "--group",
          "nope",
          "--module",
          "src/profile.effx.ts",
        ]);

        assert.strictEqual(unknown.code, 1, `${unknown.stdout}\n${unknown.stderr}`);
        assert.include(unknown.stdout, "EFFX3008");

        const missing = yield* runCli(project.directory, ["lift", "--group", "profile"]);

        assert.strictEqual(missing.code, 1);
        assert.include(missing.stderr, "--module is required");
      }).pipe(Effect.scoped, Effect.provide(services)),
    900_000,
  );
});
