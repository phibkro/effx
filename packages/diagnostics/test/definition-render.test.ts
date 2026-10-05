import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  defineDiagnostic,
  renderCatalogue,
  renderEntry,
  type DiagnosticEntry,
} from "../src/index.ts";

const entry = {
  code: "EFFX2504",
  owner: "access",
  title: "Broad access",
  severity: "warning",
  severityPolicy: {
    kind: "named",
    name: "strictAccess",
    description: "strictAccess promotes the warning to an error.",
  },
  explanation: "Declare a narrower access policy.",
  examples: [
    {
      before: "Access.public",
      after: "Access.authenticated",
      explanation: "Require authentication.",
    },
  ],
} as const satisfies DiagnosticEntry;

const params = Schema.Struct({ operation: Schema.String, strictAccess: Schema.Boolean });

const definition = defineDiagnostic(
  entry,
  params,
  (facts) => `Operation ${facts.operation} uses public access.`,
  (facts) => (facts.strictAccess ? "error" : "warning"),
);

describe("typed diagnostic factories", () => {
  it.effect("does not render or evaluate policy when a definition is built", () =>
    Effect.sync(() => {
      let calls = 0;

      const discarded = defineDiagnostic(
        entry,
        params,
        () => {
          calls++;

          return "message";
        },
        () => {
          calls++;

          return "warning";
        },
      );

      assert.strictEqual(discarded.entry, entry);
      assert.strictEqual(discarded.paramsSchema, params);
      assert.strictEqual(calls, 0);
    }),
  );

  it.effect("derives exact message and both policy modes and preserves occurrence context", () =>
    Effect.sync(() => {
      const location = { file: "operations.ts", line: 3, col: 5 };
      const related = [definition.emit({ operation: "Other", strictAccess: false })];

      const ordinary = definition.emit(
        { operation: "Users.List", strictAccess: false },
        { location, related },
      );

      assert.deepStrictEqual(ordinary, {
        code: entry.code,
        severity: "warning",
        message: "Operation Users.List uses public access.",
        location,
        related,
      });
      assert.strictEqual(ordinary.location, location);
      assert.strictEqual(ordinary.related, related);
      assert.strictEqual(
        definition.emit({ operation: "Users.List", strictAccess: true }).severity,
        "error",
      );
      assert.deepStrictEqual(
        Object.keys(definition.emit({ operation: "Users.List", strictAccess: false })),
        ["code", "severity", "message"],
      );
    }),
  );

  it.effect("fixed policies use only their declared default", () =>
    Effect.sync(() => {
      const fixed = defineDiagnostic(
        { ...entry, severityPolicy: { kind: "fixed" } },
        Schema.Struct({ value: Schema.String }),
        (facts) => `Value ${facts.value}`,
      );

      assert.deepStrictEqual(fixed.emit({ value: "one" }), {
        code: entry.code,
        severity: "warning",
        message: "Value one",
      });
    }),
  );

  it.effect("boundary decoding remains a caller operation, not work hidden in emit", () =>
    Effect.gen(function* () {
      const facts = yield* Schema.decodeEffect(definition.paramsSchema)({
        operation: "Users.List",
        strictAccess: true,
      });

      assert.strictEqual(definition.emit(facts).severity, "error");

      const invalid = yield* Effect.flip(
        Schema.decodeUnknownEffect(definition.paramsSchema)({ operation: 1, strictAccess: true }),
      );

      assert.strictEqual(invalid._tag, "SchemaError");
    }),
  );
});

describe("diagnostic Markdown projection", () => {
  it.effect("renders complete deterministic explanation with one final newline", () =>
    Effect.sync(() => {
      assert.strictEqual(
        renderEntry(entry),
        "# EFFX2504 — Broad access\n\nOwner: access\n\nDefault severity: warning\n\nSeverity policy: strictAccess — strictAccess promotes the warning to an error.\n\nDeclare a narrower access policy.\n\n## Example 1\n\nBefore:\n\n```text\nAccess.public\n```\n\nAfter:\n\n```text\nAccess.authenticated\n```\n\nRequire authentication.\n",
      );
    }),
  );

  it.effect("preserves the complete namespaced identifier in plain explain headings", () =>
    Effect.sync(() => {
      const plugin = { ...entry, code: "EFFX[@acme/effx-plugin]/0001", owner: "@acme/effx-plugin" };
      assert.isTrue(
        renderEntry(plugin).startsWith("# EFFX[@acme/effx-plugin]/0001 — Broad access\n"),
      );
      assert.include(renderCatalogue([plugin]), "EFFX&#91;@acme/effx-plugin&#93;/0001");
    }),
  );

  it.effect("escapes labels and protects fences from source-controlled delimiters", () =>
    Effect.sync(() => {
      const unsafe = {
        ...entry,
        title: "A | <Tag> {expression} [link] *bold* `code` & label\n# heading",
        examples: [
          {
            before: "```\n{danger()}\n</Tag>\n``````",
            after: "fixed",
            explanation: "Use fixed.",
            language: "ts\n```\n{danger()}",
          },
        ],
      } as const satisfies DiagnosticEntry;

      const rendered = renderCatalogue([unsafe]);
      assert.include(rendered, "A &#124; &#60;Tag&#62; &#123;expression&#125;");
      assert.notInclude(rendered, "<Tag>");
      assert.include(rendered, "```````tsdanger\n```\n{danger()}\n</Tag>\n``````\n```````");
      assert.include(rendered, '<a id="diagnostic-effx2504" />');
    }),
  );

  it.effect("catalogue order and anchors depend only on full codes", () =>
    Effect.sync(() => {
      const first = { ...entry, code: "EFFX[@acme/one]/0001", owner: "@acme/one" };
      const second = { ...entry, code: "EFFX[@acme-one]/0001", owner: "@acme-one" };
      const inputs = [second, entry, first];
      const rendered = renderCatalogue(inputs);
      assert.strictEqual(rendered, renderCatalogue(inputs.toReversed()));
      assert.isTrue(
        rendered.startsWith("# Diagnostic catalogue\n\n| Code | Title | Default severity |"),
      );
      assert.include(rendered, "diagnostic-effx-5b--40-acme-2f-one-5d--2f-0001");
      assert.include(rendered, "diagnostic-effx-5b--40-acme-2d-one-5d--2f-0001");
      assert.strictEqual(rendered.slice(-2), ".\n");
      assert.strictEqual(inputs[0], second);
    }),
  );
});
