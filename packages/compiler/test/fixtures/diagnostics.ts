import { defineDiagnostic } from "@effx/diagnostics";
import { Schema } from "effect";

// Two extension-authoring suites share registered entries, not permissive string helpers.
const documentation = {
  owner: "compiler-test-plugin",
  title: "Test extension finding",
  severityPolicy: { kind: "fixed" as const },
  explanation: "A test extension reports its declared finding to exercise the public pipeline.",
  examples: [
    {
      before: "test extension finding",
      after: "test extension resolved",
      explanation: "Resolve the test condition.",
    },
  ] as const,
};

export const dropped = defineDiagnostic(
  { ...documentation, code: "EFFX[compiler-test-plugin]/0001", severity: "error" },
  Schema.Struct({}),
  () => "dropped",
);

export const first = defineDiagnostic(
  { ...documentation, code: "EFFX[compiler-test-plugin]/0002", severity: "warning" },
  Schema.Struct({}),
  () => "first",
);

export const second = defineDiagnostic(
  { ...documentation, code: "EFFX[compiler-test-plugin]/0003", severity: "warning" },
  Schema.Struct({}),
  () => "second",
);

export const annotation = defineDiagnostic(
  { ...documentation, code: "EFFX[compiler-test-plugin]/0004", severity: "warning" },
  Schema.Struct({}),
  () => "plugin annotation",
);

export const failure = defineDiagnostic(
  { ...documentation, code: "EFFX[compiler-test-plugin]/0005", severity: "error" },
  Schema.Struct({}),
  () => "plugin error",
);

export const analysis = defineDiagnostic(
  { ...documentation, code: "EFFX[compiler-test-plugin]/0006", severity: "warning" },
  Schema.Struct({}),
  () => "plugin analysis",
);

export const note = defineDiagnostic(
  { ...documentation, code: "EFFX[compiler-test-plugin]/0007", severity: "warning" },
  Schema.Struct({ subject: Schema.String, text: Schema.String }),
  ({ subject, text }) => `${subject}: ${text}`,
);
