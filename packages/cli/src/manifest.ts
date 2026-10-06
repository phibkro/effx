import { Option, Schema } from "effect";
import {
  type Collected,
  Diagnostic,
  EmitMode,
  Naming,
  Extensions,
  Location,
  SchemaArg,
  SpreadSource,
  findAnnotation,
} from "@effx/compiler";

import { StableId } from "@effx/ir";

/** `.effx/manifest.json` (spec 0003, ADR 0003): everything the IR deliberately omits. */
export const Manifest = Schema.Struct({
  format: Schema.Literal("effx-manifest"),
  version: Schema.Literal(1),
  compiler: Schema.Struct({
    effx: Schema.String,
    effect: Schema.String,
    typescript: Schema.String,
  }),
  semanticHash: Schema.String,
  emit: EmitMode,
  naming: Schema.optionalKey(Naming),
  generated: Schema.Array(Schema.String),
  diagnostics: Schema.Array(Diagnostic),
  locations: Schema.Record(StableId.StableId, Location),
  spreads: Schema.optionalKey(Schema.Array(SpreadSource)),
});

export type Manifest = typeof Manifest.Type;

export const ManifestJson = Schema.fromJsonString(Manifest, { space: 2 });

/** Decode the previous compiler-owned file list, including manifests written before emit modes. */
export const PreviousManifestJson = Schema.fromJsonString(
  Schema.Struct({
    format: Schema.Literal("effx-manifest"),
    version: Schema.Literal(1),
    generated: Schema.Array(Schema.String),
  }),
);

const ModelArgs = Schema.Tuple([Schema.Struct({ schema: SchemaArg })]);

/**
 * Operation and model ids → where they are declared. Pure: the declaration carries its
 * location (spec 0002 revised); `operationIdOf` and the model's schema export are the identity
 * rules of the core extension.
 */
export const locationsOf = (
  collected: Collected,
  relative: (file: string) => string,
): Record<StableId.StableId, Location> => {
  const locations: Record<StableId.StableId, Location> = {};

  for (const declaration of collected.declarations) {
    if (declaration.location === undefined) continue;
    const location = { ...declaration.location, file: relative(declaration.location.file) };
    const operation = Extensions.operationIdOf(declaration);

    if (Option.isSome(operation)) locations[operation.value] = location;
    const model = findAnnotation(declaration, "PersistentModel");

    const args =
      model === undefined ? Option.none() : Schema.decodeUnknownOption(ModelArgs)(model.args);

    if (Option.isSome(args)) {
      locations[StableId.make("model", args.value[0].schema.ref.export)] = location;
    }
  }

  return locations;
};
