import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { readManifest, readVerifiedBlob, sha256Of } from "./lift-corpus.ts";
import {
  manifestText,
  migrateStableEffect,
  migrationId,
  migrationRules,
  staleText,
} from "./lift-corpus-migration.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

const encoder = new TextEncoder();

const fragments = [...migrationRules.flatMap((rule) => [rule.from, rule.to]), "\n", " ", "x"];

/** Every file of every snapshot as text, read after its bytes were proven against the manifest. */
const readCorpus = Effect.fnUntraced(function* () {
  const manifest = yield* readManifest();
  const texts = new Map<string, Map<string, string>>();

  for (const snapshot of manifest.snapshots) {
    const files = new Map<string, string>();

    for (const file of snapshot.files)
      files.set(file.path, decoder.decode((yield* readVerifiedBlob(snapshot, file)).bytes));

    texts.set(snapshot.name, files);
  }

  return { manifest, texts };
});

describe("0019 stable corpus migration laws", () => {
  it.prop(
    "is idempotent over arbitrary joins of its own rule texts",
    [Schema.Array(Schema.Literals(fragments))],
    ([parts]) => {
      const once = migrateStableEffect(parts.join(""));

      assert.strictEqual(migrateStableEffect(once), once);
    },
    { arbitrary: { runs: 500 } },
  );

  it("never lets a rule produce another rule's input", () => {
    for (const first of migrationRules)
      for (const second of migrationRules)
        assert.isFalse(first.to.includes(second.from), `${first.applied}: ${first.to}`);
  });

  it.effect("applies every rule to the historical corpus and stays idempotent over it", () =>
    Effect.gen(function* () {
      const { manifest, texts } = yield* readCorpus();

      const historical = manifest.snapshots
        .filter((snapshot) => snapshot.role === "historical")
        .flatMap((snapshot) => [...(texts.get(snapshot.name)?.values() ?? [])]);

      assert.isAbove(historical.length, 300);

      for (const rule of migrationRules)
        assert.isTrue(
          historical.some((text) => text.includes(rule.from)),
          `rule from ${rule.applied} never applies: ${rule.from}`,
        );

      for (const text of historical) {
        const once = migrateStableEffect(text);

        assert.strictEqual(migrateStableEffect(once), once);
      }
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("derives each stable snapshot exactly from the historical bytes it names", () =>
    Effect.gen(function* () {
      const { manifest, texts } = yield* readCorpus();
      const stables = manifest.snapshots.filter((snapshot) => snapshot.role === "stable");
      const problems: Array<string> = [];

      assert.deepStrictEqual(
        stables.map((snapshot) => snapshot.name),
        ["stable-original", "stable-oracle"],
      );

      for (const stable of stables) {
        const historical = manifest.snapshots.find(
          (snapshot) => snapshot.name === stable.derivedFrom,
        );

        const sources = texts.get(stable.derivedFrom ?? "");

        if (historical === undefined || sources === undefined || historical.role !== "historical") {
          problems.push(`${stable.name}: names no historical snapshot`);
          continue;
        }

        if (stable.migration !== migrationId) problems.push(`${stable.name}: migration id`);

        if (stable.revision !== historical.revision) problems.push(`${stable.name}: revision`);

        assert.deepStrictEqual(stable.entry, historical.entry, `${stable.name}: entry`);

        assert.deepStrictEqual(
          stable.unresolvedGeneratedImports,
          historical.unresolvedGeneratedImports,
          `${stable.name}: unresolved generated imports`,
        );

        // The stable snapshot trims nothing: it lists every logical path, in the same order.
        assert.deepStrictEqual(
          stable.files.map((file) => file.path),
          historical.files.map((file) => file.path),
          `${stable.name}: logical paths`,
        );

        for (const [index, file] of stable.files.entries()) {
          const original = historical.files[index];
          const before = sources.get(file.path);

          if (original === undefined || before === undefined || original.path !== file.path) {
            problems.push(`${stable.name}/${file.path}: no historical bytes`);
            continue;
          }

          const migrated = migrateStableEffect(before);

          if (file.originalSha256 !== original.sha256)
            problems.push(`${stable.name}/${file.path}: original hash`);

          if (file.origin === "migrated") {
            if (migrated === before) problems.push(`${stable.name}/${file.path}: nothing migrated`);

            if ((yield* sha256Of(encoder.encode(migrated))) !== file.sha256)
              problems.push(`${stable.name}/${file.path}: not the derivation`);
          } else if (migrated !== before || file.sha256 !== original.sha256) {
            problems.push(`${stable.name}/${file.path}: changed without a migration`);
          }
        }
      }

      assert.deepStrictEqual(problems, []);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("leaves no unstable entry point or removed spelling in a stable snapshot", () =>
    Effect.gen(function* () {
      const { manifest, texts } = yield* readCorpus();
      const found: Array<string> = [];

      for (const snapshot of manifest.snapshots.filter((entry) => entry.role === "stable"))
        for (const [path, text] of texts.get(snapshot.name) ?? [])
          for (const stale of staleText)
            if (text.includes(stale)) found.push(`${snapshot.name}/${path}: ${stale}`);

      assert.deepStrictEqual(found, []);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("records the digest of every snapshot's sorted path and hash list", () =>
    Effect.gen(function* () {
      const { manifest } = yield* readCorpus();

      for (const snapshot of manifest.snapshots)
        assert.strictEqual(
          yield* sha256Of(encoder.encode(manifestText(snapshot.files))),
          snapshot.snapshotSha256,
          snapshot.name,
        );
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
