import { Array as Arr, Option, Order } from "effect";
import type { SymbolRef } from "@effx/ir";
import type { LiftRegistry } from "../annotation.ts";
import { makeContext } from "./context.ts";
import { idOf, membersOf, selectGroup } from "./group.ts";
import type { LiftInput } from "./input.ts";
import type { EffectModel, EndpointRecord } from "./model.ts";
import { sameRef } from "./refs.ts";
import { refOf, stringOf } from "./view.ts";

/*
 * What the native check needs of the ONE selected group, read from a model with the lift's own readers
 * (spec 0019 §2.4, §0.8, §7): the exported group, the key set of its endpoint declarations and, for the
 * ORIGINAL group, the unique application root and the root identity the fresh comparison root reuses.
 * Nothing here is evaluated or invented: a group the lift cannot select or represent has no facts.
 */

/** The group a model declares: its exported symbol and the keys of the endpoints it adds. */
export interface GroupKeys {
  /** The exported group, resolved by the frontend. */
  readonly group: SymbolRef;
  /** Every endpoint declaration key of the group: sorted, unique, literal. */
  readonly endpointKeys: ReadonlyArray<string>;
  /** Endpoint declarations whose key is not a literal; when positive the key set is not provable. */
  readonly unreadableKeys: number;
}

/** The original group's facts, which add the unique root exactly as the model records it. */
export interface CheckFacts extends GroupKeys {
  readonly groupId: string;
  /** The identity literal of the unique original application root (`HttpApi.make(<rootId>)`). */
  readonly rootId: string;
  /** The exported original application root whose composition stays untouched and UNVERIFIED. */
  readonly root: SymbolRef;
}

const keyOf = (endpoint: EndpointRecord): Option.Option<string> =>
  endpoint.key._tag === "Lowered" ? stringOf(endpoint.key.term) : Option.none();

const keysOf = (
  group: SymbolRef,
  endpoints: ReadonlyArray<EndpointRecord>,
  unresolved: number,
): GroupKeys => {
  const keys = endpoints.map(keyOf);

  return {
    group,
    endpointKeys: Arr.dedupe(keys.flatMap(Option.toArray)).toSorted(Order.String),
    unreadableKeys: keys.filter(Option.isNone).length + unresolved,
  };
};

/** The facts of the group `input.group` selects, or none when the lift cannot select it (EFFX3008, blocked). */
export const checkFactsOf = (
  model: EffectModel,
  input: LiftInput,
  registry: LiftRegistry,
): Option.Option<CheckFacts> => {
  const selection = selectGroup(makeContext(model, input, registry));

  if (selection._tag !== "Ready") return Option.none();

  const { facts } = selection;

  return Option.some({
    ...keysOf(facts.group.symbol, facts.endpoints, facts.missing.length),
    groupId: facts.groupId,
    rootId: facts.rootId,
    root: facts.root.symbol,
  });
};

/**
 * The one group of this id a model declares, without needing a root: the generated contract declares its
 * group alone. Several or none is none; a member without an endpoint declaration counts as unreadable.
 */
export const groupKeysOf = (model: EffectModel, groupId: string): Option.Option<GroupKeys> => {
  const groups = model.groups.filter((group) =>
    Option.exists(idOf(group.id), (id) => id === groupId),
  );

  const [group] = groups;

  if (group === undefined || groups.length > 1) return Option.none();

  const members = membersOf(group.steps).map((member) =>
    Option.flatMap(refOf(member), (symbol) =>
      Option.fromUndefinedOr(model.endpoints.find((endpoint) => sameRef(endpoint.symbol, symbol))),
    ),
  );

  return Option.some(
    keysOf(group.symbol, members.flatMap(Option.toArray), members.filter(Option.isNone).length),
  );
};
