import { Option, Predicate, type Schema } from "effect";
import type { SymbolRef } from "@effx/ir";
import type { Diagnostic } from "../Diagnostic.ts";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { Term } from "../generate/term.ts";
import type { Cause } from "./causes.ts";
import { findingCause, nameOfSymbol, type Context } from "./context.ts";
import type { EndpointRecord, GroupRecord, RootRecord, StepRecord } from "./model.ts";
import { nativeCalleeOf, nativeName, type NativeCallee } from "./native.ts";
import { sameRef } from "./refs.ts";
import type { SourceRange, TermSlot } from "./source.ts";
import { callView, isJsonObject, objectOf, refOf, stringOf } from "./view.ts";

/*
 * Group selection (spec 0019 §3.3, §0.8): the unique original root supplies identity and binding facts.
 * Only group-level behavior must be expressible by the generated group. Original root composition stays
 * in the source model and is preserved during a manual group-reference substitution, never generated.
 */

/** What the group declaration records of itself (`Http.Group` title, description and display name). */
export interface GroupInfo {
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly displayName: string | undefined;
}

/** A member of `.add(...)` the model has no endpoint declaration for. */
export interface MissingMember {
  readonly subject: string;
  readonly cause: Cause;
}

export interface GroupFacts {
  readonly group: GroupRecord;
  readonly root: RootRecord;
  readonly groupId: string;
  readonly rootId: string;
  readonly info: GroupInfo;
  /** Endpoint declarations in `.add` order. */
  readonly endpoints: ReadonlyArray<EndpointRecord>;
  readonly missing: ReadonlyArray<MissingMember>;
}

export type GroupSelection =
  /** EFFX3008: no such group, or not in exactly one root. */
  | { readonly _tag: "Missing"; readonly diagnostic: Diagnostic }
  /** The group exists but its own declaration cannot be represented. */
  | {
      readonly _tag: "Blocked";
      readonly group: GroupRecord;
      readonly causes: ReadonlyArray<Cause>;
    }
  | { readonly _tag: "Ready"; readonly facts: GroupFacts };

interface Reader {
  readonly ctx: Context;
  readonly subject: string;
  readonly causes: Array<Cause>;
}

const record = (reader: Reader, at: SourceRange, diagnostic: Diagnostic): void => {
  reader.causes.push({ at, diagnostic });
};

const construct = (reader: Reader, at: SourceRange, what: string): void => {
  record(
    reader,
    at,
    LiftDiagnostics.EFFX3001.emit({
      _tag: "GroupConstruct",
      subject: reader.subject,
      construct: what,
    }),
  );
};

/** The term of a slot, or none after recording the causes of its findings. */
const lowered = (reader: Reader, slot: TermSlot): Option.Option<Term> => {
  if (slot._tag === "Lowered") return Option.some(slot.term);

  reader.causes.push(
    ...slot.findings.map((finding) =>
      findingCause(reader.ctx, reader.subject, "structure", finding),
    ),
  );

  return Option.none();
};

const nativeOf = (reader: Reader, term: Term): NativeCallee | undefined =>
  nativeCalleeOf(reader.ctx.model.project.target, reader.ctx.model.natives, term);

type MethodStep = Extract<StepRecord, { readonly _tag: "Method" }>;

const idOf = (slot: TermSlot): Option.Option<string> =>
  slot._tag === "Lowered" ? stringOf(slot.term) : Option.none();

const membersOf = (steps: ReadonlyArray<StepRecord>): ReadonlyArray<Term> =>
  steps.flatMap((step) =>
    step._tag === "Method" && step.name === "add"
      ? step.args.flatMap((slot) => (slot._tag === "Lowered" ? [slot.term] : []))
      : [],
  );

const symbolName = (symbol: SymbolRef): string => nameOfSymbol(symbol);

/** Checks the constructor claim of a declaration: `HttpApiGroup.make` / `HttpApi.make`. */
const checkConstructor = (
  reader: Reader,
  slot: TermSlot,
  kind: "HttpApiGroup" | "HttpApi",
  at: SourceRange,
): void => {
  const term = lowered(reader, slot);

  if (Option.isNone(term)) return;

  const native = nativeOf(reader, term.value);

  if (native?.kind !== kind || nativeName(native) !== "make")
    construct(reader, at, `a ${kind} constructor that is not the native ${kind}.make`);
};

const stringOption = (value: Schema.Json | undefined): string | undefined =>
  Predicate.isString(value) ? value : undefined;

const noInfo: GroupInfo = { title: undefined, description: undefined, displayName: undefined };

/** `OpenApi.annotations({ title, description, override: { "x-displayName" } })` of a group. */
const readOpenApi = (reader: Reader, step: MethodStep): GroupInfo => {
  const [slot] = step.args;

  if (step.args.length !== 1 || slot === undefined) {
    construct(reader, step.range, ".annotateMerge without exactly one argument");

    return noInfo;
  }

  const term = lowered(reader, slot);

  if (Option.isNone(term)) return noInfo;

  const view = callView(term.value);
  const callee = view === undefined ? undefined : nativeOf(reader, view.callee);

  if (view === undefined || callee?.kind !== "OpenApi" || nativeName(callee) !== "annotations") {
    construct(reader, step.range, ".annotateMerge argument that is not OpenApi.annotations");

    return noInfo;
  }

  const [argument] = view.args;
  const object = argument === undefined || view.args.length !== 1 ? undefined : objectOf(argument);

  if (object === undefined || Option.isNone(object)) {
    record(
      reader,
      step.range,
      LiftDiagnostics.EFFX3001.emit({
        _tag: "NonLiteralArgument",
        subject: reader.subject,
        callee: "OpenApi.annotations",
        argument: "annotations object",
      }),
    );

    return noInfo;
  }

  const unsupported = (option: string): void => {
    record(
      reader,
      step.range,
      LiftDiagnostics.EFFX3001.emit({
        _tag: "UnsupportedOption",
        subject: reader.subject,
        callee: "OpenApi.annotations",
        option,
      }),
    );
  };

  const override = object.value.override;
  const overrides = override !== undefined && isJsonObject(override) ? override : undefined;

  for (const name of Object.keys(object.value))
    if (!["title", "description", "override"].includes(name)) unsupported(name);

  if (override !== undefined && overrides === undefined) unsupported("override");

  for (const key of Object.keys(overrides ?? {}))
    if (key !== "x-displayName") unsupported(`override.${key}`);

  const displayName = overrides?.["x-displayName"];

  if (displayName !== undefined && !Predicate.isString(displayName))
    unsupported("override.x-displayName");

  return {
    title: stringOption(object.value.title),
    description: stringOption(object.value.description),
    displayName: Predicate.isString(displayName) ? displayName : undefined,
  };
};

/** What reading the group declaration yields: its own info and the symbols `.add` lists. */
interface GroupRead {
  readonly info: GroupInfo;
  readonly endpoints: ReadonlyArray<SymbolRef>;
}

const readGroup = (reader: Reader, group: GroupRecord): GroupRead => {
  checkConstructor(reader, group.callee, "HttpApiGroup", group.range);

  if (group.options._tag === "Unlowered")
    reader.causes.push(
      ...group.options.findings.map((finding) =>
        findingCause(reader.ctx, reader.subject, "structure", finding),
      ),
    );
  else if (group.options._tag === "Entries")
    for (const entry of group.options.entries)
      if (entry._tag === "Unsupported")
        reader.causes.push(findingCause(reader.ctx, reader.subject, "structure", entry.finding));
      else
        record(
          reader,
          entry.range,
          LiftDiagnostics.EFFX3001.emit({
            _tag: "UnsupportedOption",
            subject: reader.subject,
            callee: "HttpApiGroup.make",
            option: entry.name,
          }),
        );

  let info: GroupInfo = noInfo;
  const endpoints: Array<SymbolRef> = [];

  for (const step of group.steps) {
    if (step._tag === "Unsupported")
      reader.causes.push(findingCause(reader.ctx, reader.subject, "structure", step.finding));
    else if (step._tag === "Apply") construct(reader, step.range, "a .pipe step on a group");
    else if (step.name === "add")
      for (const slot of step.args) {
        const member = slot._tag === "Lowered" ? refOf(slot.term) : Option.none();

        if (Option.isSome(member)) endpoints.push(member.value);
        else if (slot._tag === "Unlowered") lowered(reader, slot);
        else construct(reader, slot.range, "a group member that is not an exported endpoint");
      }
    else if (step.name === "annotateMerge") {
      const patch = readOpenApi(reader, step);

      info = {
        title: patch.title ?? info.title,
        description: patch.description ?? info.description,
        displayName: patch.displayName ?? info.displayName,
      };
    } else construct(reader, step.range, `.${step.name}(...) on a group`);
  }

  return { info, endpoints };
};

const readRoot = (reader: Reader, root: RootRecord): Option.Option<string> => {
  checkConstructor(reader, root.callee, "HttpApi", root.range);

  const id = idOf(root.id);

  if (Option.isNone(id) && root.id._tag === "Lowered")
    record(
      reader,
      root.id.range,
      LiftDiagnostics.EFFX3001.emit({
        _tag: "ComputedKey",
        subject: reader.subject,
        construct: "root identifier",
      }),
    );
  else if (root.id._tag === "Unlowered") lowered(reader, root.id);

  return id;
};

/** Finds the group, its unique root and every declaration-level cause. */
export const selectGroup = (ctx: Context): GroupSelection => {
  const wanted = ctx.input.group;

  const groups = ctx.model.groups.filter((group) =>
    Option.exists(idOf(group.id), (id) => id === wanted),
  );

  const [group] = groups;

  if (group === undefined)
    return {
      _tag: "Missing",
      diagnostic: LiftDiagnostics.EFFX3008.emit({ _tag: "NotFound", group: wanted }),
    };

  if (groups.length > 1)
    return {
      _tag: "Missing",
      diagnostic: LiftDiagnostics.EFFX3008.emit({
        _tag: "AmbiguousGroup",
        group: wanted,
        declarations: groups.map((candidate) => symbolName(candidate.symbol)),
      }),
    };

  const roots = ctx.model.roots.filter((candidate) =>
    membersOf(candidate.steps).some((term) =>
      Option.exists(refOf(term), (ref) => sameRef(ref, group.symbol)),
    ),
  );

  const [root] = roots;

  if (root === undefined)
    return {
      _tag: "Missing",
      diagnostic: LiftDiagnostics.EFFX3008.emit({ _tag: "NoRoot", group: wanted }),
    };

  if (roots.length > 1)
    return {
      _tag: "Missing",
      diagnostic: LiftDiagnostics.EFFX3008.emit({
        _tag: "AmbiguousRoots",
        group: wanted,
        roots: roots.map((candidate) => symbolName(candidate.symbol)),
      }),
    };

  const reader: Reader = { ctx, subject: wanted, causes: [] };
  const read = readGroup(reader, group);
  const rootId = readRoot(reader, root);

  const endpoints = read.endpoints.flatMap((symbol) => {
    const found = ctx.model.endpoints.find((endpoint) => sameRef(endpoint.symbol, symbol));

    return found === undefined ? [] : [found];
  });

  const missing = read.endpoints.flatMap((symbol): ReadonlyArray<MissingMember> =>
    ctx.model.endpoints.some((endpoint) => sameRef(endpoint.symbol, symbol))
      ? []
      : [
          {
            subject: `${wanted}.${symbolName(symbol)}`,
            cause: {
              at: group.range,
              diagnostic: LiftDiagnostics.EFFX3001.emit({
                _tag: "UnrecognizedConstruct",
                subject: `${wanted}.${symbolName(symbol)}`,
                construct: `group member ${symbolName(symbol)} has no endpoint declaration in the analyzed project`,
              }),
            },
          },
        ],
  );

  return reader.causes.length > 0 || Option.isNone(rootId)
    ? { _tag: "Blocked", group, causes: reader.causes }
    : {
        _tag: "Ready",
        facts: {
          group,
          root,
          groupId: wanted,
          rootId: rootId.value,
          info: read.info,
          endpoints,
          missing,
        },
      };
};
