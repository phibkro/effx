/**
 * @title Registering a package-owned diagnostic
 *
 * New extension packages own namespaced codes, not unused numeric codes (spec 0016 §3).
 * This analysis requires every Command to have an AuditPolicy contribution, without adding IR
 * or generated files. Select `auditRequired` in `effx.config.ts` alongside the Audit interpreter.
 */
import { defineDiagnostic, type DiagnosticEntry, type Extension } from "@effx/compiler";
import { IRGraph } from "@effx/ir";
import { Schema } from "effect";

export const missingAudit = defineDiagnostic(
  {
    code: "EFFX[@acme/effx-audit]/0001",
    owner: "@acme/effx-audit",
    title: "Command lacks an audit policy",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "Every Command must carry an AuditPolicy ExtensionOf contribution. Queries are exempt. Register the Audit interpreter and annotate each Command before generating the application.",
    examples: [
      {
        before: '@Command("Billing.Charge")',
        after: '@Command("Billing.Charge")\n@Annotate("Audit", { level: "sensitive" })',
        explanation:
          "Attach the audit policy and register the Audit interpreter in effx.config.ts.",
        language: "ts",
      },
    ],
  } as const satisfies DiagnosticEntry,
  Schema.Struct({ operation: Schema.String }),
  ({ operation }) => `${operation}: Command needs an AuditPolicy contribution`,
);

export const auditRequired: Extension = {
  name: "@acme/effx-audit/required",
  diagnosticEntries: [missingAudit.entry],
  interpreters: {},
  analyses: [
    (ir, index) =>
      ir.nodes.flatMap((node) => {
        if (node._tag !== "Operation" || node.kind !== "Command") return [];

        const audited = IRGraph.incoming(index, node.id, "ExtensionOf").some(
          (edge) => edge.qualifier === "AuditPolicy",
        );

        return audited ? [] : [missingAudit.emit({ operation: node.name })];
      }),
  ],
  generators: [],
};

// Offline lookup does not compile a project. Explicit config opts in to loading plugin entries:
// effx explain 'EFFX[@acme/effx-audit]/0001' --config ./effx.config.ts
