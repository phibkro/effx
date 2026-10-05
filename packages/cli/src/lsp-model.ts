import { Schema } from "effect";
import type { Diagnostic, Location } from "@effx/diagnostics";

const Natural = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Position = Schema.Struct({ line: Natural, character: Natural });

export const Range = Schema.Struct({ start: Position, end: Position });

const Identifier = Schema.Struct({ uri: Schema.String });

const VersionedIdentifier = Schema.Struct({ uri: Schema.String, version: Schema.Int });

export const Initialize = Schema.Struct({
  processId: Schema.optionalKey(Schema.NullOr(Natural)),
  rootUri: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rootPath: Schema.optionalKey(Schema.NullOr(Schema.String)),
  workspaceFolders: Schema.optionalKey(
    Schema.NullOr(Schema.Array(Schema.Struct({ uri: Schema.String, name: Schema.String }))),
  ),
  capabilities: Schema.Struct({
    textDocument: Schema.optionalKey(
      Schema.Struct({
        publishDiagnostics: Schema.optionalKey(
          Schema.Struct({
            relatedInformation: Schema.optionalKey(Schema.Boolean),
            versionSupport: Schema.optionalKey(Schema.Boolean),
            codeDescriptionSupport: Schema.optionalKey(Schema.Boolean),
          }),
        ),
      }),
    ),
    general: Schema.optionalKey(
      Schema.Struct({ positionEncodings: Schema.optionalKey(Schema.Array(Schema.String)) }),
    ),
  }),
  initializationOptions: Schema.optionalKey(Schema.Json),
  trace: Schema.optionalKey(Schema.Literals(["off", "messages", "verbose"])),
});

export type Initialize = typeof Initialize.Type;

export const decodeInitialize = Schema.decodeUnknownEffect(Initialize);

export const decodeInitialized = Schema.decodeUnknownEffect(Schema.Struct({}));

export const decodeOpen = Schema.decodeUnknownEffect(
  Schema.Struct({
    textDocument: Schema.Struct({
      uri: Schema.String,
      languageId: Schema.String,
      version: Schema.Int,
      text: Schema.String,
    }),
  }),
);

export const decodeChange = Schema.decodeUnknownEffect(
  Schema.Struct({
    textDocument: VersionedIdentifier,
    contentChanges: Schema.Array(
      Schema.Struct({
        range: Schema.optionalKey(Range),
        rangeLength: Schema.optionalKey(Natural),
        text: Schema.String,
      }),
    ),
  }),
);

export const decodeClose = Schema.decodeUnknownEffect(Schema.Struct({ textDocument: Identifier }));

export const decodeSave = Schema.decodeUnknownEffect(
  Schema.Struct({ textDocument: Identifier, text: Schema.optionalKey(Schema.String) }),
);

export const decodeConfiguration = Schema.decodeUnknownEffect(
  Schema.Struct({
    settings: Schema.Struct({
      effx: Schema.optionalKey(
        Schema.Struct({
          project: Schema.optionalKey(Schema.String),
          config: Schema.optionalKey(Schema.String),
          outDir: Schema.optionalKey(Schema.String),
          target: Schema.optionalKey(Schema.String),
          emit: Schema.optionalKey(Schema.String),
          strictAccess: Schema.optionalKey(Schema.Boolean),
          trustConfig: Schema.optionalKey(Schema.Boolean),
          executableFiles: Schema.optionalKey(Schema.Array(Schema.String)),
          executableDirectories: Schema.optionalKey(Schema.Array(Schema.String)),
        }),
      ),
    }),
  }),
);

export const decodeWatchedFiles = Schema.decodeUnknownEffect(
  Schema.Struct({
    changes: Schema.Array(Schema.Struct({ uri: Schema.String, type: Schema.Literals([1, 2, 3]) })),
  }),
);

export const decodeTrace = Schema.decodeUnknownEffect(
  Schema.Struct({ value: Schema.Literals(["off", "messages", "verbose"]) }),
);

export const decodeShutdown = Schema.decodeUnknownEffect(
  Schema.Union([Schema.Null, Schema.Undefined]),
);

export const capabilities = {
  capabilities: {
    positionEncoding: "utf-16",
    textDocumentSync: { openClose: true, change: 2, save: { includeText: false } },
  },
} satisfies Schema.Json;

/** Selection only; URI admission and startup-relative path resolution belong to the owner. */
export const selectRoot = (
  params: Initialize,
  explicitProject: string | undefined,
  cwd: string,
): { readonly kind: "path" | "uri"; readonly value: string } | undefined => {
  if (explicitProject !== undefined) return { kind: "path", value: explicitProject };

  if (params.workspaceFolders && params.workspaceFolders.length > 1) return undefined;

  if (params.workspaceFolders?.length === 1)
    return { kind: "uri", value: params.workspaceFolders[0].uri };

  if (params.rootUri !== undefined && params.rootUri !== null)
    return { kind: "uri", value: params.rootUri };

  return { kind: "path", value: params.rootPath ?? cwd };
};

export interface ProjectionSupport {
  readonly relatedInformation: boolean;
  readonly codeDescription: boolean;
  readonly bundledCodes: { readonly has: (code: string) => boolean };
  readonly registryHref: string;
}

/** Compiler points are UTF-16 units already. Reject out-of-snapshot points, never clamp. */
export const pointRange = (location: Location, text: string): typeof Range.Type | undefined => {
  const lines = text.split(/\r\n|\r|\n/u);
  const line = location.line - 1;
  const character = location.col - 1;
  const content = lines[line];

  if (
    !Number.isInteger(line) ||
    !Number.isInteger(character) ||
    line < 0 ||
    character < 0 ||
    content === undefined ||
    character > content.length
  )
    return undefined;
  const before = content.charCodeAt(character - 1);
  const after = content.charCodeAt(character);

  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return undefined;

  return { start: { line, character }, end: { line, character } };
};

export const severity = (diagnostic: Diagnostic): 1 | 2 | 3 =>
  diagnostic.severity === "error" ? 1 : diagnostic.severity === "warning" ? 2 : 3;

export const diagnosticLog = (diagnostic: Diagnostic): string =>
  `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}\nRun effx explain '${diagnostic.code}' for guidance.`;

export type RelatedInformation = {
  location: { uri: string; range: typeof Range.Type };
  message: string;
};

export type ProjectedDiagnostic = {
  range: typeof Range.Type;
  severity: 1 | 2 | 3;
  source: "effx";
  code: string;
  message: string;
  relatedInformation?: ReadonlyArray<RelatedInformation>;
  codeDescription?: { href: string };
};

export type DiagnosticsPublication = {
  uri: string;
  diagnostics: ReadonlyArray<ProjectedDiagnostic>;
  version?: number;
};

/** Snapshot lookups carry canonical URI identity; this projection performs no IO. */
export const projectDiagnostic = (
  diagnostic: Diagnostic,
  lookup: (location: Location) => { readonly uri: string; readonly text: string } | undefined,
  support: ProjectionSupport,
):
  | {
      readonly uri: string;
      readonly diagnostic: ProjectedDiagnostic;
      readonly logs: ReadonlyArray<string>;
    }
  | undefined => {
  if (!diagnostic.location) return undefined;
  const source = lookup(diagnostic.location);
  const range = source && pointRange(diagnostic.location, source.text);

  if (!source || !range) return undefined;
  const relatedInformation: RelatedInformation[] = [];
  const logs: string[] = [];

  const visit = (related: Diagnostic): void => {
    const target = related.location && lookup(related.location);
    const relatedRange = target && related.location && pointRange(related.location, target.text);

    if (target && relatedRange && support.relatedInformation) {
      relatedInformation.push({
        location: { uri: target.uri, range: relatedRange },
        message: related.message,
      });
    } else logs.push(diagnosticLog(related));

    for (const nested of related.related ?? []) visit(nested);
  };

  for (const related of diagnostic.related ?? []) visit(related);

  const projected: ProjectedDiagnostic = {
    range,
    severity: severity(diagnostic),
    source: "effx",
    code: diagnostic.code,
    message: diagnostic.message,
  };

  if (relatedInformation.length > 0) projected.relatedInformation = relatedInformation;

  if (support.codeDescription && support.bundledCodes.has(diagnostic.code))
    projected.codeDescription = {
      href: `${support.registryHref}#${encodeURIComponent(diagnostic.code)}`,
    };

  return { uri: source.uri, diagnostic: projected, logs };
};
