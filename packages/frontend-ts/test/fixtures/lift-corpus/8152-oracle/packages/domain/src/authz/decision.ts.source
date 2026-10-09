import { Data } from "effect";

export type DecisionReason =
  | "Unauthenticated"
  | "NotInScope"
  | "AuthorityInactive"
  | "Ambiguous"
  | "RequirementFailed";

export type Decision<A> =
  | { readonly _tag: "Allow"; readonly value: A }
  | { readonly _tag: "Deny"; readonly reason: DecisionReason };

interface DecisionDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: Decision<this["A"]>;
}

const Decision = Data.taggedEnum<DecisionDefinition>();

export const allow = <A>(value: A): Extract<Decision<A>, { readonly _tag: "Allow" }> =>
  Decision.Allow({ value });

export const deny = <A = never>(reason: DecisionReason): Decision<A> => Decision.Deny({ reason });
