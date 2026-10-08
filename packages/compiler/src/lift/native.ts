import { Schema } from "effect";
import { SymbolRef } from "@effx/ir";
import { TargetProfile } from "../Collected.ts";
import { defaultGenerationContext } from "../Extension.ts";
import { Imports } from "../generate/target.ts";
import type { Term } from "../generate/term.ts";
import { sameRef } from "./refs.ts";

/*
 * Native Effect identity (spec 0019 §3.4). The frontend resolves identity from declarations, never from
 * spelling: it follows import aliases and re-exports to the declaring namespace and accepts both the
 * `~effect/http-api/*` and `~effect/httpapi/*` type brands. The core never re-derives that; it validates the
 * frontend's typed claim against the ONE profile table the generator imports from (`generate/target.ts`), so
 * `effect/http-api` (stable) and `effect/unstable/httpapi` (rc.116) are never frozen as a literal here.
 */

/** The native Effect namespaces the lift reads. Each is a namespace export whose members the core names. */
export const NativeKind = Schema.Literals([
  "HttpApiEndpoint",
  "HttpApiGroup",
  "HttpApi",
  "HttpApiSchema",
  "HttpApiBuilder",
  "OpenApi",
  "Schema",
  "SchemaAST",
]);

export type NativeKind = typeof NativeKind.Type;

/** Which module family of the target profile a kind belongs to (a key of `generate/target.ts`'s table). */
export const NativeFamily = Schema.Literals(["core", "httpApi"]);

export type NativeFamily = typeof NativeFamily.Type;

/** Total by construction: adding a kind without a family does not compile. */
export const nativeFamilies: Readonly<Record<NativeKind, NativeFamily>> = {
  HttpApiEndpoint: "httpApi",
  HttpApiGroup: "httpApi",
  HttpApi: "httpApi",
  HttpApiSchema: "httpApi",
  HttpApiBuilder: "httpApi",
  OpenApi: "httpApi",
  Schema: "core",
  SchemaAST: "core",
};

/**
 * A native callee or value, concretely: the semantic kind, the target profile the claim was made under, the
 * reference exactly as it appears in the lowered term, and the static member the term selects from it
 * (`HttpApiEndpoint` + `get`, `HttpApiSchema` + `NoContent`; absent when the reference itself is the value).
 */
export const NativeCallee = Schema.Struct({
  kind: NativeKind,
  target: TargetProfile,
  ref: SymbolRef,
  member: Schema.optionalKey(Schema.String),
});

export type NativeCallee = typeof NativeCallee.Type;

const within = (module: string, root: string): boolean =>
  module === root || module.startsWith(`${root}/`);

/**
 * Is `module` inside the module family the target profile maps `kind` to? The family roots come from the
 * generator's own profile table, so the stable and rc.116 layouts are both answered by one source.
 */
export const isNativeModule = (
  target: TargetProfile,
  kind: NativeKind,
  module: string,
): boolean => {
  const profile = Imports({ ...defaultGenerationContext, target });
  const family = nativeFamilies[kind];

  if (!within(module, profile[family])) return false;

  return (
    family === "httpApi" ||
    Object.entries(profile).every(([name, root]) => name === "core" || !within(module, root))
  );
};

/**
 * The native identity a term names, or `undefined`. A term names a native when it is `Ref(r)` or
 * `Member(Ref(r), m)` and the frontend's inventory claims `(r, m)` under the model's own target and
 * inside the family the profile table assigns to the claimed kind. Anything else is not native.
 */
export const nativeCalleeOf = (
  target: TargetProfile,
  natives: ReadonlyArray<NativeCallee>,
  term: Term,
): NativeCallee | undefined => {
  const selection =
    term._tag === "Ref"
      ? { ref: term.ref, member: undefined }
      : term._tag === "Member" && term.term._tag === "Ref"
        ? { ref: term.term.ref, member: term.member }
        : undefined;

  return selection === undefined
    ? undefined
    : natives.find(
        (entry) =>
          entry.target === target &&
          entry.member === selection.member &&
          sameRef(entry.ref, selection.ref) &&
          isNativeModule(target, entry.kind, entry.ref.module),
      );
};
