import { bundledDiagnosticEntries } from "@effx/compiler";
import { composeRegistry, renderCatalogue } from "@effx/diagnostics";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderRepositoryMarkdown } from "../../../scripts/ai-docs.ts";
import { renderDiagnosticPage } from "../../../scripts/docs-sync.ts";

describe("diagnostic documentation projections", () => {
  it.effect("uses the complete shared catalogue for the site and package guidance", () =>
    Effect.gen(function* () {
      const registry = yield* composeRegistry(bundledDiagnosticEntries);
      const body = renderCatalogue(registry.entries);
      const site = renderDiagnosticPage(registry.entries);
      const guidance = renderRepositoryMarkdown("# Repository guidance\n\n", registry.entries);

      assert.strictEqual(registry.entries.length, 71);
      assert.isTrue(site.startsWith("---\ntitle:"));
      assert.isTrue(site.endsWith(body));
      assert.strictEqual(guidance, `# Repository guidance\n\n${body}`);
      assert.isTrue(body.endsWith("\n"));

      for (const entry of registry.entries) assert.isTrue(body.includes(entry.code));
    }),
  );

  it.effect("makes registry prose drift change both projections without editing AI sources", () =>
    Effect.gen(function* () {
      const registry = yield* composeRegistry(bundledDiagnosticEntries);

      const changed = yield* composeRegistry(
        registry.entries.map((entry, index) =>
          index === 0
            ? { ...entry, explanation: `${entry.explanation}\n\nA new repair detail.` }
            : entry,
        ),
      );

      const before = renderRepositoryMarkdown("# Unchanged source", registry.entries);
      const after = renderRepositoryMarkdown("# Unchanged source", changed.entries);

      assert.notStrictEqual(after, before);
      assert.isTrue(after.includes("A new repair detail."));
      assert.notStrictEqual(
        renderDiagnosticPage(changed.entries),
        renderDiagnosticPage(registry.entries),
      );
      assert.isTrue(
        renderDiagnosticPage(changed.entries).endsWith(renderCatalogue(changed.entries)),
      );
    }),
  );
});
