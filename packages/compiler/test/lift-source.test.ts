import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";
import {
  EffectModel,
  Extensions,
  LiftInput,
  bundledDiagnosticEntries,
  compileCollected,
  lift,
  liftRegistryOf,
  printSuggestion,
  renderPatch,
  type LiftResult,
} from "@effx/compiler";
import { applyPatch } from "./lift-apply.ts";
import {
  chunkOf,
  negativeFile,
  negativeFiles,
  negativeUniverse,
  negatives,
  profileFiles,
  sourceInput,
  sourceUniverse,
  subjectOf,
} from "./lift-fixtures.ts";
import { modelOf, type SourceFile } from "./lift-source.ts";

/*
 * The pure core over real source text (spec 0019 §3.3, §4.3, §10): the Profile group lowered from text,
 * its refactors rendered as a unified diff, and the law that makes a refactor trustworthy: after the printed
 * patch is applied, lifting the patched source gives the very same suggestion and nothing is left to
 * refactor. The negative inventory pins every way an endpoint is unsupported to its code and its position.
 */

const model = modelOf(profileFiles, sourceUniverse);

const input = sourceInput("profile");

const lifted = lift(model, input, liftRegistryOf([]));

const texts = new Map(profileFiles.map((entry) => [entry.path, entry.contents] as const));

const patchOf = (files: ReadonlyArray<SourceFile>, result: LiftResult) =>
  renderPatch({
    refactors: result.refactors,
    files: modelOf(files, sourceUniverse).files,
    texts: new Map(files.map((entry) => [entry.path, entry.contents] as const)),
    allowImportingTsExtensions: false,
  }).pipe(Effect.provide(BunServices.layer));

describe("the Profile group lowered from source text", () => {
  it("lifts the read as written and the patch with its refactors", () => {
    assert.deepStrictEqual(lifted.unsupported, []);
    assert.deepStrictEqual(
      lifted.collected.declarations.map((declaration) => declaration.id),
      ["ProfileGroup", "ReadOwnProfile", "UpdateOwnProfile"],
    );
  });

  it("plans the codes tuples, the inline query and the wrapper's headers as four refactors", () => {
    assert.deepStrictEqual(
      lifted.refactors.map((refactor) => [refactor.code, refactor.file]),
      [
        ["EFFX3004", "src/endpoint-problems.ts"],
        ["EFFX3002", "src/profile.ts"],
        ["EFFX3004", "src/endpoint-problems.ts"],
        ["EFFX3003", "src/http-semantics.ts"],
      ],
    );
  });

  it("anchors every edit in the text it was planned against", () => {
    for (const refactor of lifted.refactors) {
      const text = texts.get(refactor.file) ?? "";

      for (const edit of refactor.edits) {
        if (edit._tag === "InsertExport") {
          assert.strictEqual(text.slice(edit.at.offset, edit.at.offset + 6), "export");
          assert.strictEqual(edit.at.line, text.slice(0, edit.at.offset).split("\n").length);
        }

        if (edit._tag === "Replace") {
          const replaced = text.slice(edit.range.start.offset, edit.range.end.offset);

          // A refactor replaces exactly the inline expression it extracts.
          if (refactor.code === "EFFX3002")
            assert.strictEqual(replaced, "{ dryRun: Schema.String }");
          else if (refactor.code === "EFFX3003")
            assert.strictEqual(replaced, "{ etag: Schema.String }");
          else assert.match(replaced, /^\[\s*"[^]*"\s*,?\s*\]$/u);
        }
      }
    }
  });

  it.effect("compiles to error-free IR", () =>
    Effect.gen(function* () {
      const compiled = yield* compileCollected(lifted.collected, Extensions.builtin);

      assert.deepStrictEqual(compiled.diagnostics, []);
      assert.isTrue(Option.isSome(compiled.ir.value));
    }),
  );

  it.effect("prints the suggestion against the tuples and schema the refactors plan", () =>
    Effect.sync(() => {
      const printed = printSuggestion(lifted.collected, {
        module: input.output.module,
        codeReferences: lifted.codeReferences,
      });

      assert.isTrue(Result.isSuccess(printed));

      const text = Result.getOrElse(printed, (message) => message);

      assert.include(text, "codes: ProfileReadOwnProfileCodes,");
      assert.include(text, "codes: ProfileUpdateOwnProfileCodes,");
      assert.include(text, "query: ProfileUpdateOwnProfileQuery,");
      assert.include(
        text,
        'import { ProfileReadOwnProfileCodes, ProfileUpdateOwnProfileCodes, nativeProblems } from "./endpoint-problems.js";',
      );
    }),
  );
});

describe("refactors are patches that a person can apply", () => {
  it.effect("renders each file's edits as a unified diff", () =>
    Effect.gen(function* () {
      const patch = yield* patchOf(profileFiles, lifted);

      assert.include(patch, "--- a/src/endpoint-problems.ts\n+++ b/src/endpoint-problems.ts");
      assert.include(patch, "--- a/src/profile.ts\n+++ b/src/profile.ts");
      assert.include(
        patch,
        '+export const ProfileReadOwnProfileCodes = ["request.malformed","precondition.failed"] as const;',
      );
      assert.include(
        patch,
        "+export const ProfileUpdateOwnProfileQuery = Schema.Struct({ dryRun: Schema.String });",
      );
      assert.include(
        patch,
        "-  query: { dryRun: Schema.String },\n+  query: ProfileUpdateOwnProfileQuery,",
      );
      assert.include(patch, "--- a/src/http-semantics.ts\n+++ b/src/http-semantics.ts");
      assert.include(
        patch,
        "+export const ProfileReadResponseHeaders = Schema.Struct({ etag: Schema.String });",
      );
      assert.include(
        patch,
        "-  HttpApiSchema.WithHeaders(schema, { etag: Schema.String });\n+  HttpApiSchema.WithHeaders(schema, ProfileReadResponseHeaders);",
      );
    }),
  );

  it.effect(
    "lifts to the same suggestion once the patch is applied, with nothing left to refactor",
    () =>
      Effect.gen(function* () {
        const patch = yield* patchOf(profileFiles, lifted);
        const patched = applyPatch(profileFiles, patch);
        const again = lift(modelOf(patched, sourceUniverse), input, liftRegistryOf([]));

        assert.isTrue(
          patched.some((entry, index) => entry.contents !== profileFiles[index]?.contents),
        );
        assert.deepStrictEqual(again.refactors, []);
        assert.deepStrictEqual(again.unsupported, []);
        assert.deepStrictEqual(again.collected, lifted.collected);
      }),
  );

  it.effect("refuses text that changed after it was analyzed", () =>
    Effect.gen(function* () {
      const changed = profileFiles.map((entry) =>
        entry.path === "src/profile.ts"
          ? { ...entry, contents: `// edited\n${entry.contents}` }
          : entry,
      );

      const failure = yield* Effect.flip(patchOf(changed, lifted));

      assert.strictEqual(failure._tag, "CompilerFault");
      assert.include(failure.message, "src/profile.ts changed after it was analyzed");
    }),
  );

  it.effect("refuses a refactor for a file it is not given", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        renderPatch({
          refactors: lifted.refactors,
          files: model.files,
          texts: new Map([["src/profile.ts", texts.get("src/profile.ts") ?? ""]]),
          allowImportingTsExtensions: false,
        }).pipe(Effect.provide(BunServices.layer)),
      );

      assert.include(failure.message, "src/endpoint-problems.ts");
    }),
  );

  it.effect("is empty for a lift with no refactors", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* patchOf(profileFiles, { ...lifted, refactors: [] }), "");
    }),
  );
});

describe("the negative inventory: one endpoint per way a declaration is unsupported", () => {
  const result = lift(
    modelOf(negativeFiles, negativeUniverse),
    sourceInput("negative"),
    liftRegistryOf([]),
  );

  const source = negativeFile.contents;

  it("suggests nothing for a group none of whose endpoints can be lifted", () => {
    assert.deepStrictEqual(result.collected.declarations, []);
    assert.deepStrictEqual(result.refactors, []);
    assert.strictEqual(result.unsupported.length, negatives.length);
  });

  it.each(negatives.map((negative) => ({ negative, name: negative.name })))(
    "reports $name with the primary diagnostic where it is",
    ({ negative }) => {
      const site = result.unsupported.find(
        (candidate) => candidate.subject === subjectOf(negative),
      );

      const base = source.indexOf(chunkOf(negative));
      // A cause may sit in a declaration the endpoint refers to (a problem union), so fall back to the file.
      const inChunk = chunkOf(negative).indexOf(negative.at);
      const offset = inChunk === -1 ? source.indexOf(negative.at) : base + inChunk;
      const before = source.slice(0, offset);
      const line = before.split("\n").length;
      const col = offset - before.lastIndexOf("\n");

      assert.isDefined(site, `${subjectOf(negative)} is reported`);
      assert.strictEqual(site?.primary.code, negative.primary);
      assert.deepStrictEqual(site?.primary.location, { file: "src/negative.ts", line, col });
      assert.deepStrictEqual(
        (site?.primary.related ?? []).map((related) => related.code),
        negative.related ?? [],
      );
    },
  );

  it("orders every cause of one declaration by source position, then code", () => {
    const everything = negatives.find((negative) => negative.name.startsWith("every cause"));

    const site = result.unsupported.find(
      (candidate) => candidate.subject === subjectOf(everything ?? negatives[0]!),
    );

    const lines = [site?.primary, ...(site?.primary.related ?? [])].map(
      (diagnostic) => diagnostic?.location?.line ?? 0,
    );

    assert.deepStrictEqual(
      lines,
      lines.toSorted((left, right) => left - right),
    );
    assert.isAbove(new Set(lines).size, 2);
  });

  it("is the same whatever order the model lists its records in", () => {
    const original = modelOf(negativeFiles, negativeUniverse);

    const shuffled = lift(
      {
        ...original,
        endpoints: original.endpoints.toReversed(),
        values: original.values.toReversed(),
        natives: original.natives.toReversed(),
        files: original.files.toReversed(),
      },
      sourceInput("negative"),
      liftRegistryOf([]),
    );

    const bySubject = (left: { readonly subject: string }, right: { readonly subject: string }) =>
      left.subject < right.subject ? -1 : left.subject > right.subject ? 1 : 0;

    assert.deepStrictEqual(
      shuffled.unsupported.toSorted(bySubject),
      result.unsupported.toSorted(bySubject),
    );
  });
});

describe("the core is pure and every diagnostic it emits is registered", () => {
  const negative = lift(
    modelOf(negativeFiles, negativeUniverse),
    sourceInput("negative"),
    liftRegistryOf([]),
  );

  const registry = new Map(bundledDiagnosticEntries.map((entry) => [entry.code, entry] as const));

  it.effect("never mutates its model or its rules, and the model is plain serializable data", () =>
    Effect.gen(function* () {
      const encodeModel = Schema.encodeEffect(Schema.toCodecJson(EffectModel));
      const encodeInput = Schema.encodeEffect(Schema.toCodecJson(LiftInput));
      const before = [yield* encodeModel(model), yield* encodeInput(input)];

      const again = lift(model, input, liftRegistryOf([]));

      assert.deepStrictEqual([yield* encodeModel(model), yield* encodeInput(input)], before);
      assert.deepStrictEqual(again, lifted);
    }),
  );

  it("emits only codes of the lift family, with the severity the registry fixes for each", () => {
    const emitted = [...lifted.diagnostics, ...negative.diagnostics];

    assert.isAbove(new Set(emitted.map((diagnostic) => diagnostic.code)).size, 6);

    for (const diagnostic of emitted) {
      const entry = registry.get(diagnostic.code);

      assert.strictEqual(entry?.owner, "lift", `${diagnostic.code} is owned by lift`);
      assert.strictEqual(
        diagnostic.severity,
        entry?.severity,
        `${diagnostic.code} keeps its severity`,
      );
    }
  });

  it("reports every unsupported site as an error and never as a fault", () => {
    for (const site of negative.unsupported) {
      assert.strictEqual(site.primary.severity, "error");
      assert.isDefined(site.primary.location);
    }
  });
});
