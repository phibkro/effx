import { Data, type Schema } from "effect";
import type {
  AccessCapabilities,
  AccessConcealment,
  Capability as CapabilityValue,
  Focus as FocusValue,
  NonEmptyStrings,
} from "./Annotation.js";

// The public union groups Any and All in one member; split their discriminants for Data's constructors.
type MultipleCapabilities = Extract<AccessCapabilities, { readonly capabilities: NonEmptyStrings }>;

type MultipleVariant<Tag extends MultipleCapabilities["_tag"]> = Omit<
  MultipleCapabilities,
  "_tag"
> & { readonly _tag: Tag };

type CapabilityVariants =
  | Exclude<AccessCapabilities, MultipleCapabilities>
  | MultipleVariant<"Any">
  | MultipleVariant<"All">;

const capabilityValues = Data.taggedEnum<CapabilityVariants>();

const concealmentValues = Data.taggedEnum<AccessConcealment>();

/** Serializable focus identity (ADR 0007): a model root plus a key path. Optics are a later runtime mechanism. */
export const Focus = {
  key: (root: Schema.Top, ...path: ReadonlyArray<string>): FocusValue => ({
    _tag: "Focus",
    root,
    path,
  }),
};

/**
 * A kind of authority over a model, optionally narrowed to a focus. Nothing else of the authority
 * model exists yet.
 *
 * @example
 * ```ts
 * import { Capability, Focus } from "@effx/runtime"
 * import { Schema } from "effect"
 * import assert from "node:assert"
 *
 * const User = Schema.Struct({ id: Schema.String, email: Schema.String })
 * const ChangeEmail = Capability.make("User.ChangeEmail", {
 *   resource: User,
 *   focus: Focus.key(User, "email")
 * })
 *
 * assert.strictEqual(ChangeEmail.name, "User.ChangeEmail")
 * assert.deepStrictEqual(ChangeEmail.focus?.path, ["email"])
 * ```
 */
export const Capability = {
  make: (
    name: string,
    options: { readonly resource: Schema.Top; readonly focus?: FocusValue },
  ): CapabilityValue => {
    const capability: CapabilityValue = {
      _tag: "Capability",
      name,
      resource: options.resource,
    };

    if (options.focus === undefined) return capability;

    return { ...capability, focus: options.focus };
  },
  one: (cap: string) => capabilityValues.One({ capability: cap }),
  any: (first: string, ...rest: string[]) =>
    capabilityValues.Any({ capabilities: [first, ...rest] }),
  all: (first: string, ...rest: string[]) =>
    capabilityValues.All({ capabilities: [first, ...rest] }),
  none: capabilityValues.None(),
};

/** Source-only HTTP concealment policy values; authorization remains with the application. */
export const Concealment = {
  reveal: concealmentValues.Reveal(),
  notFound: (firstStage: string, ...rest: string[]) =>
    concealmentValues.NotFound({ stages: [firstStage, ...rest] }),
};
