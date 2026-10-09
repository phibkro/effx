import { Option, Predicate, Result, Schema } from "effect";
import type { SchemaRef } from "@effx/ir";
import type { AnnotationArg } from "../Collected.ts";
import { SchemaArg } from "../args.ts";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { ArgsPlan, Plan } from "@effx/runtime";
import type { Term } from "../generate/term.ts";
import { refIdentity, sameRef } from "./refs.ts";
import type { Scope } from "./scope.ts";
import { fail } from "./scope.ts";
import type { SourceRange } from "./source.ts";
import { type Cursor, descend, keyName, rangeOf, rootOf, stringOf } from "./view.ts";

/*
 * Default `.annotate` inversion: walk the single definition-owned ArgsPlan over the frontend's neutral
 * Term, preserving the forward-lowering semantics without evaluating any source. The final ArgsCodec
 * decode is authoritative. The frontend-ts differential Program law pins this AST/Term adapter pair; this
 * module never carries another plan or derivation.
 */

interface Failure {
  readonly construct: string;
}

export type Lowering = Result.Result<AnnotationArg, Failure>;

const failure = (construct: string): Failure => ({ construct });

const unwrapTerm = (term: Term): Term => (term._tag === "Paren" ? unwrapTerm(term.term) : term);

const unwrapPlan = (plan: Plan | undefined): Plan | undefined =>
  plan?._tag === "Injected" || plan?._tag === "Refine" ? unwrapPlan(plan.plan) : plan;

const emitCause = (scope: Scope, at: SourceRange, construct: string): void => {
  fail(
    scope,
    at,
    LiftDiagnostics.EFFX3001.emit({
      _tag: "UnrecognizedConstruct",
      subject: scope.subject,
      construct,
    }),
  );
};

const reject = <A>(scope: Scope, at: SourceRange, construct: string): Result.Result<A, Failure> => {
  emitCause(scope, at, construct);

  return Result.fail(failure(construct));
};

const collect = (items: ReadonlyArray<Lowering>): Result.Result<Array<AnnotationArg>, Failure> => {
  const output: Array<AnnotationArg> = [];

  for (const item of items) {
    if (Result.isFailure(item)) return Result.fail(item.failure);
    output.push(item.success);
  }

  return Result.succeed(output);
};

const literalString = (scope: Scope, term: Term, seen: ReadonlySet<string>): string | undefined => {
  if (term._tag === "Lit" && Predicate.isString(term.json) && term.json.length > 0)
    return term.json;

  if (term._tag !== "Ref") return undefined;
  const key = refIdentity(term.ref);

  if (seen.has(key)) return undefined;
  const value = scope.ctx.values.get(key);

  return value?.init._tag === "Lowered"
    ? literalString(scope, value.init.term, new Set([...seen, key]))
    : undefined;
};

const runtimeMember = (
  term: Term,
):
  | { readonly namespace: "Capability" | "Concealment" | "Focus"; readonly member: string }
  | undefined => {
  const value = unwrapTerm(term);

  if (value._tag !== "Member") return undefined;
  const root = unwrapTerm(value.term);

  if (root._tag !== "Ref") return undefined;

  if (!(root.ref.module === "@effx/runtime" || root.ref.module.startsWith("@effx/runtime/")))
    return undefined;

  if (
    root.ref.export === "Capability" ||
    root.ref.export === "Concealment" ||
    root.ref.export === "Focus"
  )
    return { namespace: root.ref.export, member: value.member };

  return undefined;
};

const lower = (
  scope: Scope,
  cursor: Cursor,
  inputPlan: Plan | undefined,
  seen: ReadonlySet<string>,
): Lowering => {
  const term = unwrapTerm(cursor.term);
  const at = rangeOf(cursor);
  const plan = unwrapPlan(inputPlan);

  if (term._tag === "Lit") {
    if (
      Predicate.isString(term.json) ||
      Predicate.isNumber(term.json) ||
      Predicate.isBoolean(term.json)
    )
      return Result.succeed(term.json);

    if (Array.isArray(term.json)) {
      const itemPlan = plan?._tag === "Array" ? plan.item : undefined;

      return collect(
        term.json.map((item, index) =>
          lower(scope, descend(cursor, { _tag: "Lit", json: item }, "json", index), itemPlan, seen),
        ),
      );
    }

    const object = Schema.decodeUnknownOption(Schema.JsonObject)(term.json);

    if (Option.isSome(object)) return lowerRecord(scope, cursor, object.value, plan, seen);

    return reject(scope, at, "a literal unsupported by the annotation plan");
  }

  if (term._tag === "Arr") {
    const itemPlan = plan?._tag === "Array" ? plan.item : undefined;

    return collect(
      term.items.map((item, index) =>
        lower(scope, descend(cursor, item, "items", index), itemPlan, seen),
      ),
    );
  }

  if (term._tag === "Obj") return lowerObject(scope, cursor, term, plan, seen);

  if (term._tag === "Call") return lowerRuntimeCall(scope, cursor, term, seen);

  if (term._tag === "Ref") return lowerReference(scope, cursor, term, plan, seen);

  if (term._tag === "Member") return lowerMember(scope, cursor, term, plan);

  return reject(scope, at, "an expression outside the annotation lowering grammar");
};

const lowerRecord = (
  scope: Scope,
  cursor: Cursor,
  values: Schema.JsonObject,
  plan: Plan | undefined,
  seen: ReadonlySet<string>,
): Lowering => {
  const record: { [key: string]: AnnotationArg } = {};
  const fields = plan?._tag === "Struct" ? plan.fields : undefined;

  for (const [key, value] of Object.entries(values)) {
    const lowered = lower(
      scope,
      descend(cursor, { _tag: "Lit", json: value }, "json", key),
      fields?.[key],
      seen,
    );

    if (Result.isFailure(lowered)) return lowered;
    record[key] = lowered.success;
  }

  return Result.succeed(record);
};

const lowerObject = (
  scope: Scope,
  cursor: Cursor,
  term: Extract<Term, { readonly _tag: "Obj" }>,
  plan: Plan | undefined,
  seen: ReadonlySet<string>,
): Lowering => {
  const fields = plan?._tag === "Struct" ? plan.fields : undefined;
  const rejected = plan?._tag === "Struct" ? (plan.rejectDuplicate ?? []) : [];
  const visited = new Set<string>();
  const record: { [key: string]: AnnotationArg } = {};

  for (const [index, entry] of term.entries.entries()) {
    const key = keyName(entry.key);

    if (rejected.includes(key) && visited.has(key))
      return reject(scope, rangeOf(cursor), `duplicate field ${key}`);
    visited.add(key);

    const lowered = lower(
      scope,
      descend(cursor, entry.value, "entries", index, "value"),
      fields?.[key],
      seen,
    );

    if (Result.isFailure(lowered)) return lowered;
    record[key] = lowered.success;
  }

  return Result.succeed(record);
};

const lowerMember = (
  scope: Scope,
  cursor: Cursor,
  term: Extract<Term, { readonly _tag: "Member" }>,
  plan: Plan | undefined,
): Lowering => {
  const runtime = runtimeMember(term);

  if (runtime?.namespace === "Capability" && runtime.member === "none")
    return Result.succeed({ _tag: "None" });

  if (runtime?.namespace === "Concealment" && runtime.member === "reveal")
    return Result.succeed({ _tag: "Reveal" });
  const base = unwrapTerm(term.term);

  if (base._tag !== "Ref") return reject(scope, rangeOf(cursor), "an unresolved member reference");
  const identity = { module: base.ref.module, export: base.ref.export, member: term.member };
  const fact = scope.ctx.schemaFacts.get(refIdentity(identity));

  if (fact !== undefined) return lowerSchema(scope, cursor, fact.ref, plan);

  return Result.succeed({ _tag: "Symbol", ref: identity });
};

const lowerReference = (
  scope: Scope,
  cursor: Cursor,
  term: Extract<Term, { readonly _tag: "Ref" }>,
  plan: Plan | undefined,
  seen: ReadonlySet<string>,
): Lowering => {
  const ref = term.ref;

  if ("symbolId" in ref) return lowerSchema(scope, cursor, ref, plan);
  const key = refIdentity(ref);

  if (!seen.has(key)) {
    const value = scope.ctx.values.get(key);

    if (value !== undefined && value.init._tag === "Lowered")
      return lower(scope, rootOf(value.init), plan, new Set([...seen, key]));
  }

  const leaf = unwrapPlan(plan);

  const symbolPlan =
    leaf?._tag === "Union" ? leaf.members.find((member) => member._tag === "Symbol") : leaf;

  if (symbolPlan?._tag === "Symbol" && symbolPlan.check === "httpapi-root") {
    const root = scope.ctx.model.roots.find((record) => sameRef(record.symbol, ref));
    const identifier = root?.id._tag === "Lowered" ? stringOf(root.id.term) : Option.none();

    if (root === undefined || Option.isNone(identifier))
      return reject(scope, rangeOf(cursor), "an unrecorded HttpApi root");

    return Result.succeed({ _tag: "Symbol", ref, identifier: identifier.value });
  }

  const marker = scope.ctx.markers.get(key);

  return marker?.security === true
    ? Result.succeed({ _tag: "Symbol", ref, security: true })
    : Result.succeed({ _tag: "Symbol", ref });
};

const lowerSchema = (
  scope: Scope,
  cursor: Cursor,
  ref: SchemaRef,
  plan: Plan | undefined,
): Lowering => {
  const at = rangeOf(cursor);
  const facts = scope.ctx.schemaFacts.get(refIdentity(ref));
  const marked = facts?.headers === true;
  const leaf = unwrapPlan(plan);

  const schemaPlan =
    leaf?._tag === "Schema"
      ? leaf
      : leaf?._tag === "Union"
        ? leaf.members.find((member) => member._tag === "Schema")
        : undefined;

  const fieldKeys = schemaPlan?._tag === "Schema" ? schemaPlan.fieldKeys : undefined;

  if (fieldKeys === undefined)
    return Result.succeed(
      marked ? { _tag: "Schema", ref, marker: "headers" } : { _tag: "Schema", ref },
    );

  if (
    facts?.allKeys === undefined &&
    schemaPlan?._tag === "Schema" &&
    schemaPlan.fieldsOptional === true &&
    !marked
  )
    return Result.succeed({ _tag: "Schema", ref });

  if (facts === undefined || facts.allKeys === undefined)
    return reject(scope, at, "schema with unrecorded static fields");
  const fields = marked || fieldKeys === "required" ? facts.requiredKeys : facts.allKeys;

  if (fields === undefined) return reject(scope, at, "schema with unrecorded required fields");

  return Result.succeed(
    marked
      ? { _tag: "Schema", ref, fields: [...fields], marker: "headers" }
      : { _tag: "Schema", ref, fields: [...fields] },
  );
};

const lowerRuntimeCall = (
  scope: Scope,
  cursor: Cursor,
  term: Extract<Term, { readonly _tag: "Call" }>,
  seen: ReadonlySet<string>,
): Lowering => {
  const at = rangeOf(cursor);
  const member = runtimeMember(term.callee);

  if (member === undefined) return reject(scope, at, "an unregistered runtime call");
  const args = term.args;

  const words = (): ReadonlyArray<string> | undefined => {
    const output: Array<string> = [];

    for (const arg of args) {
      const word = literalString(scope, arg, seen);

      if (word === undefined) return undefined;
      output.push(word);
    }

    return output;
  };

  if (member.namespace === "Focus" && member.member === "key") {
    const segments: Array<string> = [];

    for (const argument of args.slice(1)) {
      if (argument._tag !== "Lit" || !Predicate.isString(argument.json))
        return reject(scope, at, "nonliteral Focus.key segment");
      segments.push(argument.json);
    }

    return Result.succeed(segments);
  }

  if (member.namespace === "Concealment" && member.member === "notFound") {
    const stages = words();

    if (stages === undefined || stages.length === 0)
      return reject(scope, at, "invalid Concealment.notFound words");

    return Result.succeed({ _tag: "NotFound", stages });
  }

  if (member.namespace === "Capability") {
    if (member.member === "none") return Result.succeed({ _tag: "None" });

    if (member.member === "one") {
      const all = words();

      if (all === undefined || all.length !== 1)
        return reject(scope, at, "invalid Capability.one words");
      const [capability] = all;

      return capability === undefined
        ? reject(scope, at, "invalid Capability.one words")
        : Result.succeed({ _tag: "One", capability });
    }

    if (member.member === "any" || member.member === "all") {
      const all = words();

      if (all === undefined || all.length === 0)
        return reject(scope, at, "invalid Capability.any/all words");

      return Result.succeed(
        member.member === "any"
          ? { _tag: "Any", capabilities: all }
          : { _tag: "All", capabilities: all },
      );
    }

    if (member.member === "make") return lowerCapabilityMake(scope, cursor, args, seen);
  }

  return reject(scope, at, "unregistered runtime call");
};

const lowerCapabilityMake = (
  scope: Scope,
  cursor: Cursor,
  args: ReadonlyArray<Term>,
  seen: ReadonlySet<string>,
): Lowering => {
  const at = rangeOf(cursor);

  if (args.length !== 2 || args[0] === undefined || args[1] === undefined)
    return reject(scope, at, "invalid Capability.make arity");

  const name =
    args[0]._tag === "Lit" && Predicate.isString(args[0].json) ? args[0].json : undefined;

  if (name === undefined) return reject(scope, at, "invalid Capability.make name");

  const options = lower(
    scope,
    rootOf({ _tag: "Lowered", term: args[1], range: at, spans: [] }),
    undefined,
    seen,
  );

  if (Result.isFailure(options)) return options;
  const resource = Schema.decodeUnknownOption(SchemaArg)(options.success);

  if (Option.isNone(resource)) return reject(scope, at, "invalid Capability.make resource");

  return Result.succeed({ name, resource: resource.value.ref.export });
};

export const lowerPlanArgs = (
  scope: Scope,
  plan: ArgsPlan,
  slots: ReadonlyArray<Cursor>,
): Result.Result<Array<AnnotationArg>, Failure> => {
  if (plan.rest === undefined && slots.length > plan.items.length)
    return reject(
      scope,
      rangeOf(slots[plan.items.length] ?? slots[0]!),
      "annotate values overrun their definition's plan",
    );

  return Result.all(
    slots.map((slot, index) =>
      lower(scope, slot, index < plan.items.length ? plan.items[index] : plan.rest, new Set()),
    ),
  );
};
