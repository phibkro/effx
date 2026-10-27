import { Result, Schema } from "effect";
import {
  CheckRepresentation,
  type DomainDescription,
  type Guard,
  type SubjectExpression,
} from "./DomainDescription.ts";

export interface AlloyGuardField {
  readonly value: string;
  readonly order: string;
  readonly ordering: string;
}

/** A trusted config-supplied compiler for one representation id. */
export type AlloyGuardCompiler = (input: {
  readonly payload: Schema.Json;
  readonly field: (path: ReadonlyArray<string>) => AlloyGuardField | undefined;
}) => string;

export interface AlloyOptions {
  readonly scope?: number;
  readonly steps?: number;
  readonly guardCompilers?: Readonly<Record<string, AlloyGuardCompiler>>;
}

const NamedAtom = Schema.Struct({ name: Schema.String, atom: Schema.String });

const MachineSymbols = Schema.Struct({
  name: Schema.String,
  context: Schema.String,
  clockPath: Schema.NullOr(Schema.Array(Schema.String)),
  fields: Schema.Array(
    Schema.Struct({
      path: Schema.Array(Schema.String),
      order: Schema.String,
      field: Schema.String,
    }),
  ),
  states: Schema.Array(NamedAtom),
  transitions: Schema.Array(
    Schema.Struct({
      atom: Schema.String,
      from: Schema.Array(Schema.String),
      to: Schema.String,
      command: Schema.optionalKey(Schema.String),
    }),
  ),
});

export type AlloyMachineSymbols = typeof MachineSymbols.Type;

/** Serialized model metadata is validated again when a generated file is checked. */
export const AlloySymbols = Schema.Struct({
  domain: Schema.String,
  scope: Schema.Int.check(Schema.isGreaterThan(0)),
  steps: Schema.Int.check(Schema.isGreaterThan(0)),
  orderedAtoms: Schema.Int.check(Schema.isGreaterThan(0)),
  scopeParts: Schema.Array(Schema.String),
  permissions: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      atom: Schema.String,
      kind: Schema.Literals(["Command", "Read"]),
    }),
  ),
  jobs: Schema.Array(NamedAtom),
  functions: Schema.Array(NamedAtom),
  positions: Schema.Array(NamedAtom),
  orders: Schema.Array(NamedAtom),
  machines: Schema.Array(MachineSymbols),
  adminApplicable: Schema.Boolean,
  clock: Schema.NullOr(Schema.Struct({ order: Schema.String })),
  nondeterministic: Schema.Array(Schema.String),
  unknownGuards: Schema.Array(Schema.String),
});

export type AlloySymbols = typeof AlloySymbols.Type;

const encodeSymbols = (symbols: AlloySymbols): string => JSON.stringify(symbols);

export interface AlloyModel {
  readonly source: string;
  readonly staticSource: string;
  readonly symbols: AlloySymbols;
  readonly unknownGuards: ReadonlyArray<string>;
}

const decodeCheck = Schema.decodeUnknownResult(CheckRepresentation);

const decodeComparison = Schema.decodeUnknownResult(
  Schema.Struct({ left: Schema.Array(Schema.String), right: Schema.Array(Schema.String) }),
);

const decodeChildren = Schema.decodeUnknownResult(Schema.Array(Schema.Json));

const pathKey = (path: ReadonlyArray<string>): string => JSON.stringify(path);

const yes = "no none";

const no = "some none";

const disjunction = (parts: ReadonlyArray<string>): string =>
  parts.length === 0 ? no : `(${parts.join(" or ")})`;

const conjunction = (parts: ReadonlyArray<string>): string =>
  parts.length === 0 ? yes : `(` + parts.join(" and ") + ")";

interface CompiledGuard {
  readonly expression: string;
  readonly unknown: ReadonlyArray<string>;
}

const compileGuard = (
  guard: Guard | undefined,
  fields: (path: ReadonlyArray<string>) => AlloyGuardField | undefined,
  registry: Readonly<Record<string, AlloyGuardCompiler>>,
): CompiledGuard => {
  if (guard === undefined) return { expression: yes, unknown: [] };

  const visit = (input: Schema.Json): CompiledGuard => {
    const decoded = decodeCheck(input);

    if (Result.isFailure(decoded)) return { expression: yes, unknown: ["invalid nested check"] };
    const check = decoded.success;

    if ("_tag" in check) {
      if (check._tag === "Filter") {
        return check.representation === undefined
          ? { expression: yes, unknown: ["opaque Filter"] }
          : visit(check.representation);
      }

      const children = check.checks.map(visit);
      const unknown = children.flatMap((child) => child.unknown);

      return {
        expression:
          unknown.length === 0 ? conjunction(children.map((child) => child.expression)) : yes,
        unknown,
      };
    }

    if (check.id === "effx/guard/not") {
      const child = visit(check.payload);

      return {
        expression: child.unknown.length === 0 ? `not (${child.expression})` : yes,
        unknown: child.unknown,
      };
    }

    if (check.id === "effx/guard/or") {
      const decodedChildren = decodeChildren(check.payload);

      if (Result.isFailure(decodedChildren))
        return { expression: yes, unknown: ["invalid or payload"] };
      const children = decodedChildren.success.map(visit);
      const unknown = children.flatMap((child) => child.unknown);

      return {
        expression:
          unknown.length === 0 ? disjunction(children.map((child) => child.expression)) : yes,
        unknown,
      };
    }

    if (check.id === "effx/order/after" || check.id === "effx/order/same") {
      const comparison = decodeComparison(check.payload);

      if (Result.isFailure(comparison)) return { expression: yes, unknown: [check.id] };
      const left = fields(comparison.success.left);
      const right = fields(comparison.success.right);

      if (left === undefined || right === undefined || left.order !== right.order) {
        return { expression: yes, unknown: [check.id] };
      }

      return {
        expression:
          check.id === "effx/order/same"
            ? `${left.value} = ${right.value}`
            : `${left.ordering}/lt[${right.value}, ${left.value}]`,
        unknown: [],
      };
    }

    const compiler = registry[check.id];

    return compiler === undefined
      ? { expression: yes, unknown: [check.id] }
      : { expression: compiler({ payload: check.payload, field: fields }), unknown: [] };
  };

  return visit(guard.representation);
};

const stateName = (machine: number, states: ReadonlyArray<string>, state: string): string =>
  state === "[*]" ? `State${machine}_Start` : `State${machine}_${states.indexOf(state)}`;

const guardParts = (
  guards: ReadonlyArray<Guard | undefined>,
  fields: (path: ReadonlyArray<string>) => AlloyGuardField | undefined,
  registry: Readonly<Record<string, AlloyGuardCompiler>>,
  unknown: Set<string>,
): string => {
  const compiled = guards.map((guard) => compileGuard(guard, fields, registry));

  for (const item of compiled) for (const id of item.unknown) unknown.add(id);

  return conjunction(compiled.map((item) => item.expression));
};

/**
 * A deterministic projection of an already-decoded domain. The returned model
 * carries both assertions and a relation-valued vector query. No process or IO
 * is started here. Scope defaults to one ordinary atom per signature and four
 * temporal steps; every declared order has exactly two atoms so strict order is
 * observable. Overrides remain explicit in the file header and result.
 */
export const generateAlloy = (
  domain: DomainDescription,
  options: AlloyOptions = {},
): AlloyModel => {
  const scope = options.scope ?? 1;
  const steps = options.steps ?? 4;
  const registry = options.guardCompilers ?? {};
  const unknown = new Set<string>();
  const nondeterministic = new Set<string>();

  const permissions = [
    ...domain.commands.map((item) => ({ name: item.name, kind: "Command" as const })),
    ...domain.reads.map((item) => ({ name: item.name, kind: "Read" as const })),
  ].map((item, index) => ({ ...item, atom: `Permission${index}` }));

  const permissionIndex = new Map(permissions.map((item, index) => [item.name, index]));
  const jobs = domain.principals.System.jobs.map((name, index) => ({ name, atom: `Job${index}` }));
  const jobIndex = new Map(jobs.map((item, index) => [item.name, index]));

  const functions = [
    ...new Set([
      ...domain.subjectSets.flatMap((subject) =>
        subject.expression._tag === "Membership" && subject.expression.function !== undefined
          ? [subject.expression.function]
          : [],
      ),
      "other",
    ]),
  ].map((name, index) => ({ name, atom: `Function${index}` }));

  const positions = [
    ...new Set([
      ...domain.subjectSets.flatMap((subject) =>
        subject.expression._tag === "Membership" && subject.expression.position !== undefined
          ? [subject.expression.position]
          : [],
      ),
      "other",
    ]),
  ].map((name, index) => ({ name, atom: `Position${index}` }));

  const functionIndex = new Map(functions.map((item, index) => [item.name, index]));
  const positionIndex = new Map(positions.map((item, index) => [item.name, index]));
  const orderIndex = new Map(domain.orders.map((item, index) => [item.name, index]));
  const clockIndex = domain.clock === undefined ? undefined : orderIndex.get(domain.clock.order);
  const subjects = new Map(domain.subjectSets.map((item) => [item.name, item.expression]));
  const orderedAtoms = Math.max(2, scope);

  const machineSymbols: Array<AlloyMachineSymbols> = domain.machines.map((machine, index) => ({
    name: machine.name,
    context: machine.context.name,
    clockPath: machine.context.clockPath ?? null,
    fields: machine.context.fields.map((field, fieldIndex) => ({
      ...field,
      field: `ctx${index}f${fieldIndex}`,
    })),
    states: [
      { name: "[*]", atom: `State${index}_Start` },
      ...machine.states.map((name, stateIndex) => ({ name, atom: `State${index}_${stateIndex}` })),
    ],
    transitions: [
      ...machine.transitions.map((transition, transitionIndex) => ({
        atom: `Transition${index}_${transitionIndex}`,
        from: transition.from,
        to: transition.to,
        command: transition.command,
      })),
      ...machine.calculated.map((transition, transitionIndex) => ({
        atom: `Transition${index}_${machine.transitions.length + transitionIndex}`,
        from: [transition.from],
        to: transition.to,
      })),
    ],
  }));

  const lines: Array<string> = [
    "module effx_domain_model",
    `// domain ${JSON.stringify(domain.name)}; scope ${scope}; steps ${steps}; each order exactly ${orderedAtoms}`,
    ...domain.orders.map((_, index) => `open util/ordering[Order${index}] as Ordering${index}`),
    "",
    "abstract sig Permission {}",
    ...permissions.map((item) => `one sig ${item.atom} extends Permission {}`),
    "abstract sig Job {}",
    ...jobs.map((item) => `one sig ${item.atom} extends Job {}`),
    "abstract sig TeamFunction {}",
    ...functions.map((item) => `one sig ${item.atom} extends TeamFunction {}`),
    "abstract sig Position {}",
    ...positions.map((item) => `one sig ${item.atom} extends Position {}`),
    ...domain.orders.map((_, index) => `sig Order${index} {}`),
    ...(clockIndex === undefined ? [] : [`one sig Clock { var now: one Order${clockIndex} }`]),
    "abstract sig Principal {}",
    "one sig Anonymous extends Principal {}",
    "sig Person extends Principal {}",
    "sig System extends Principal { job: one Job }",
    "sig Department {}",
    "sig Team { teamFunction: one TeamFunction, department: one Department }",
    "sig MembershipRecord { member: one Person, team: one Team, position: one Position }",
    "sig Target { owner: lone Person, targetDepartment: lone Department }",
    "var sig Membership in MembershipRecord {}",
    "var sig Admin in Person {}",
    "abstract sig Subject {}",
    ...domain.subjectSets.map((_, index) => `one sig Subject` + index + " extends Subject {}"),
    "abstract sig GrantRow {}",
    ...domain.grants.map((_, index) => `one sig Grant` + index + " extends GrantRow {}"),
    "one sig GrantTable { rowPermits: GrantRow -> Permission, rowSubject: GrantRow -> Subject }",
    `fact GrantRows { GrantTable.rowPermits = ` +
      (domain.grants
        .flatMap((grant, index) =>
          grant.permits.map(
            (permission) => `Grant` + index + " -> Permission" + permissionIndex.get(permission),
          ),
        )
        .join(" + ") || "none -> none") +
      " and GrantTable.rowSubject = " +
      (domain.grants
        .map(
          (grant, index) =>
            `Grant` +
            index +
            " -> Subject" +
            domain.subjectSets.findIndex((subject) => subject.name === grant.subject),
        )
        .join(" + ") || "none -> none") +
      " }",
  ];

  for (const [machineIndex, machine] of domain.machines.entries()) {
    const clockField =
      machine.context.clockPath === undefined
        ? -1
        : machine.context.fields.findIndex(
            (field) => pathKey(field.path) === pathKey(machine.context.clockPath!),
          );

    lines.push(
      `abstract sig State${machineIndex} {}`,
      `one sig State${machineIndex}_Start extends State${machineIndex} {}`,
      ...machine.states.map(
        (_, index) => `one sig State${machineIndex}_${index} extends State${machineIndex} {}`,
      ),
      `abstract sig Transition${machineIndex} {}`,
      ...machineSymbols[machineIndex]!.transitions.map(
        (transition) => `one sig ${transition.atom} extends Transition${machineIndex} {}`,
      ),
      `sig Context${machineIndex} { ${machine.context.fields.map((field, index) => `${index === clockField ? "var " : ""}ctx${machineIndex}f${index}: one Order${orderIndex.get(field.order)}`).join(", ")} }`,
      `one sig Machine${machineIndex} { var current${machineIndex}: lone State${machineIndex} }`,
      `fact MachineState${machineIndex} { always (State${machineIndex}_Start not in Machine${machineIndex}.current${machineIndex}) }`,
      ...(clockIndex === undefined || clockField < 0
        ? []
        : [
            `fact ClockBinding${machineIndex} { always (all ctx: Context${machineIndex} | ctx.ctx${machineIndex}f${clockField} = Clock.now) }`,
          ]),
    );
  }

  // The static companion has the same declarations but no temporal operators.
  const staticLines = lines.map((line, index) => {
    if (index === 0) return "module effx_domain_vectors";

    if (line.startsWith("//")) return line;

    return line.replaceAll("var ", "").replace("always (", "(");
  });

  const subject = (expression: SubjectExpression, membershipOnly: boolean): string => {
    switch (expression._tag) {
      case "Membership": {
        const parts = ["m.member = p"];

        if (!membershipOnly) parts.push("m in MembershipRecord");

        if (expression.term === "active") parts.push("m in Membership");

        if (expression.function !== undefined)
          parts.push(`m.team.teamFunction = Function${functionIndex.get(expression.function)}`);

        if (expression.position !== undefined)
          parts.push(`m.position = Position${positionIndex.get(expression.position)}`);

        if (expression.department === "target")
          parts.push("some t.targetDepartment", "m.team.department = t.targetDepartment");
        const match = conjunction(parts);

        return membershipOnly ? match : `(some m: MembershipRecord | ${match})`;
      }

      case "Self":
        return membershipOnly ? no : "p = t.owner";
      case "Admin":
        return membershipOnly ? no : "p in Admin";
      case "System":
        return membershipOnly ? no : `(p in System and p.job = Job${jobIndex.get(expression.job)})`;
      case "Union":
        return disjunction(
          expression.sets.map((name) => subject(subjects.get(name)!, membershipOnly)),
        );
    }
  };

  const scopeOf = (scopeName: (typeof domain.grants)[number]["scope"]): string => {
    switch (scopeName) {
      case "all":
        return yes;
      case "own":
        return "p = t.owner";
      case "department":
        return "(some t.targetDepartment and some m: Membership | m.member = p and m.team.department = t.targetDepartment)";
    }
  };

  const grantTerm = (grant: (typeof domain.grants)[number], membershipOnly: boolean): string => {
    const selected = subjects.get(grant.subject)!;

    const permissionsExpression = disjunction(
      grant.permits.map((name) => `c = Permission${permissionIndex.get(name)}`),
    );

    return conjunction([
      permissionsExpression,
      scopeOf(grant.scope),
      subject(selected, membershipOnly),
    ]);
  };

  const predicateStart = lines.length;
  lines.push(
    "",
    `pred can[p: Principal, c: Permission, t: Target] { ${disjunction(domain.grants.map((grant) => grantTerm(grant, false)))} }`,
    `pred canByMembership[m: MembershipRecord, p: Principal, c: Permission, t: Target] { ${disjunction(domain.grants.map((grant) => grantTerm(grant, true)))} }`,
    ...domain.commands.map(
      (_, index) =>
        `pred command${index}[p: Principal, t: Target] { can[p, Permission${index}, t] }`,
    ),
  );
  staticLines.push(...lines.slice(predicateStart));

  const onlyJob = (expression: SubjectExpression, job: string): boolean => {
    switch (expression._tag) {
      case "System":
        return expression.job === job;
      case "Union":
        return expression.sets.every((name) => onlyJob(subjects.get(name)!, job));
      default:
        return false;
    }
  };

  const hasSubject = (expression: SubjectExpression): boolean =>
    expression._tag !== "Union" || expression.sets.some((name) => hasSubject(subjects.get(name)!));

  const presentSubjects =
    domain.subjectSets
      .flatMap((subject, index) => (hasSubject(subject.expression) ? [`Subject` + index] : []))
      .join(" + ") || "none";

  const coverage = domain.commands.map((command, index) => {
    const covered =
      `some g: GrantRow | (Permission` +
      index +
      " in g.(GrantTable.rowPermits) and g.(GrantTable.rowSubject) in (" +
      presentSubjects +
      "))";

    if (command.runBy === undefined) return `(` + covered + ")";

    const safeSubjects =
      domain.subjectSets
        .flatMap((subject, subjectIndex) =>
          onlyJob(subject.expression, command.runBy!.job) ? [`Subject` + subjectIndex] : [],
        )
        .join(" + ") || "none";

    const exclusive =
      `no g: GrantRow | (Permission` +
      index +
      " in g.(GrantTable.rowPermits) and not (g.(GrantTable.rowSubject) in (" +
      safeSubjects +
      ")))";

    return conjunction([`(` + covered + ")", `(` + exclusive + ")"]);
  });

  const machineFields =
    (machineIndex: number, prefix: string) =>
    (path: ReadonlyArray<string>): AlloyGuardField | undefined => {
      const fieldIndex = domain.machines[machineIndex]!.context.fields.findIndex(
        (field) => pathKey(field.path) === pathKey(path),
      );

      if (fieldIndex < 0) return undefined;
      const field = domain.machines[machineIndex]!.context.fields[fieldIndex]!;

      const clockPath = domain.machines[machineIndex]!.context.clockPath;

      const isClockField =
        clockIndex !== undefined && clockPath !== undefined && pathKey(clockPath) === pathKey(path);

      let value = `${prefix}${fieldIndex}`;

      if (prefix === "ctx" || prefix === "next") value = `ctx.ctx${machineIndex}f${fieldIndex}`;

      if (prefix === "vn") value = `v${fieldIndex}`;

      if ((prefix === "next" || prefix === "vn") && isClockField) {
        const current = prefix === "next" ? "Clock.now" : `v${fieldIndex}`;
        value = `Ordering${clockIndex}/next[${current}]`;
      }

      return { value, order: field.order, ordering: `Ordering${orderIndex.get(field.order)}` };
    };

  const contextFormula = (
    machineIndex: number,
    guards: ReadonlyArray<Guard | undefined>,
    variable: string,
  ): string => guardParts(guards, machineFields(machineIndex, variable), registry, unknown);

  const clockedCondition = (
    machineIndex: number,
    guard: Guard | undefined,
    variable: string,
    description: string,
  ) => {
    const paths = new Set<string>();
    const field = machineFields(machineIndex, variable);

    const compiled = compileGuard(
      guard,
      (path) => {
        paths.add(pathKey(path));

        return field(path);
      },
      registry,
    );

    for (const id of compiled.unknown) unknown.add(id);
    const clockPath = domain.machines[machineIndex]!.context.clockPath;

    const bound =
      clockIndex !== undefined &&
      clockPath !== undefined &&
      guard !== undefined &&
      paths.has(pathKey(clockPath)) &&
      compiled.unknown.length === 0;

    if (!bound) nondeterministic.add(description);

    return { expression: bound ? compiled.expression : yes, bound };
  };

  const clockStay = clockIndex === undefined ? yes : "Clock.now' = Clock.now";

  const clockCanAdvance =
    clockIndex === undefined ? yes : `Clock.now != Ordering${clockIndex}/last`;

  const afterTickAvailable = clockIndex === undefined ? no : clockCanAdvance;

  const clockAdvance =
    clockIndex === undefined
      ? yes
      : `(Clock.now != Ordering${clockIndex}/last and Clock.now' = Ordering${clockIndex}/next[Clock.now])`;

  const frameOthers = (index: number): ReadonlyArray<string> =>
    domain.machines.flatMap((_, other) =>
      other === index ? [] : [`Machine${other}.current${other}' = Machine${other}.current${other}`],
    );

  const adminFrame = (command: string): string =>
    domain.adminList?.grant === command
      ? "Admin' = Admin + t.owner"
      : domain.adminList?.revoke === command
        ? "Admin' = Admin - t.owner"
        : "Admin' = Admin";

  const isCurrent = (machineIndex: number, state: string): string =>
    state === "[*]"
      ? `no Machine${machineIndex}.current${machineIndex}`
      : `Machine${machineIndex}.current${machineIndex} = ${stateName(machineIndex, domain.machines[machineIndex]!.states, state)}`;

  const becomes = (machineIndex: number, state: string): string =>
    state === "[*]"
      ? `no Machine${machineIndex}.current${machineIndex}'`
      : `Machine${machineIndex}.current${machineIndex}' = ${stateName(machineIndex, domain.machines[machineIndex]!.states, state)}`;

  const stepPredicates: Array<string> = [];
  const edgeNames: Array<string> = [];
  const enabled: Array<string> = [];
  const tickRules: Array<string> = [];
  const tickChanges: Array<string> = [];

  for (const [machineIndex, machine] of domain.machines.entries()) {
    const edges: Array<string> = [];
    const enabledNow: Array<string> = [];
    const enabledAfterTick: Array<string> = [];
    const calculatedChoices: Array<string> = [];
    const requiredCalculations: Array<string> = [];

    const allTransitions = [
      ...machine.transitions.map((transition) => ({
        from: transition.from,
        to: transition.to,
        guards: [transition.when, transition.guard],
        command: transition.command,
      })),
      ...machine.calculated.map((transition) => ({
        from: [transition.from],
        to: transition.to,
        guards: [transition.when],
        command: undefined,
      })),
    ];

    for (const [transitionIndex, transition] of allTransitions.entries()) {
      const from = disjunction(transition.from.map((state) => isCurrent(machineIndex, state)));
      const calculated = transition.command === undefined;
      const label = `machine ${machine.name} calculated transition ${transitionIndex - machine.transitions.length} lacks a clock-bound guard`;

      const nowGuard = calculated
        ? clockedCondition(machineIndex, transition.guards[0], "ctx", label).expression
        : contextFormula(machineIndex, transition.guards, "ctx");

      const nextCondition = calculated
        ? clockedCondition(machineIndex, transition.guards[0], "next", label)
        : undefined;

      const nextGuard =
        nextCondition?.expression ?? contextFormula(machineIndex, transition.guards, "next");

      const guard = calculated ? nextGuard : nowGuard;

      const sources = disjunction(
        transition.from.map((state) => `s = ${stateName(machineIndex, machine.states, state)}`),
      );

      enabledNow.push(
        conjunction([`tr = Transition${machineIndex}_${transitionIndex}`, sources, nowGuard]),
      );
      enabledAfterTick.push(
        conjunction([
          `tr = Transition${machineIndex}_${transitionIndex}`,
          sources,
          nextGuard,
          afterTickAvailable,
        ]),
      );

      const boundPath = machine.context.clockPath;

      const clockValue =
        boundPath === undefined ? undefined : machineFields(machineIndex, "v")(boundPath)?.value;

      const advancePossible =
        clockIndex === undefined
          ? yes
          : clockValue === undefined
            ? `(some tick: Order${clockIndex} | tick != Ordering${clockIndex}/last)`
            : `${clockValue} != Ordering${clockIndex}/last`;

      const satisfiableGuard = calculated
        ? conjunction([
            clockedCondition(machineIndex, transition.guards[0], "vn", label).expression,
            advancePossible,
          ])
        : contextFormula(machineIndex, transition.guards, "v");

      const declaration = machine.context.fields
        .flatMap((field, fieldIndex) =>
          new RegExp(`\\bv${fieldIndex}\\b`).test(satisfiableGuard)
            ? [`v${fieldIndex}: Order${orderIndex.get(field.order)}`]
            : [],
        )
        .join(", ");

      const satisfiable =
        declaration.length === 0 ? satisfiableGuard : `(some ${declaration} | ${satisfiableGuard})`;

      for (const source of transition.from) {
        edges.push(
          conjunction([
            `a = ${stateName(machineIndex, machine.states, source)}`,
            `b = ${stateName(machineIndex, machine.states, transition.to)}`,
            satisfiable,
          ]),
        );
      }

      const change = [from, becomes(machineIndex, transition.to), guard];

      if (transition.command !== undefined) {
        const commandIndex = permissionIndex.get(transition.command);
        lines.push(
          `pred transition${machineIndex}_${transitionIndex}[p: Principal, t: Target, ctx: Context${machineIndex}] { ${conjunction([`command${commandIndex}[p, t]`, "Membership' = Membership", adminFrame(transition.command), clockStay, ...change, ...frameOthers(machineIndex)])} }`,
        );
        stepPredicates.push(
          `(some p: Principal, t: Target, ctx: Context${machineIndex} | transition${machineIndex}_${transitionIndex}[p, t, ctx])`,
        );
      } else {
        lines.push(
          `pred calculated${machineIndex}_${transitionIndex}[ctx: Context${machineIndex}] { ${conjunction(change)} }`,
        );
        calculatedChoices.push(
          `(some ctx: Context${machineIndex} | calculated${machineIndex}_${transitionIndex}[ctx])`,
        );

        if (nextCondition?.bound === true)
          requiredCalculations.push(
            `(some ctx: Context${machineIndex} | ${conjunction([from, nextGuard])})`,
          );
      }
    }

    const unchanged = `Machine${machineIndex}.current${machineIndex}' = Machine${machineIndex}.current${machineIndex}`;
    tickRules.push(
      disjunction([
        ...calculatedChoices,
        conjunction([`not ${disjunction(requiredCalculations)}`, unchanged]),
      ]),
    );
    tickChanges.push(
      `Machine${machineIndex}.current${machineIndex}' != Machine${machineIndex}.current${machineIndex}`,
    );
    const edge = `edges${machineIndex}`;
    edgeNames.push(edge);
    lines.push(
      `fun ${edge}: State${machineIndex} -> State${machineIndex} { { a, b: State${machineIndex} | ${disjunction(edges)} } }`,
    );
    enabled.push(
      `Projection.enabledNow${machineIndex} = { s: State${machineIndex}, ctx: Context${machineIndex}, tr: Transition${machineIndex} | ${disjunction(enabledNow)} }`,
    );
    enabled.push(
      `Projection.enabledAfterTick${machineIndex} = { s: State${machineIndex}, ctx: Context${machineIndex}, tr: Transition${machineIndex} | ${disjunction(enabledAfterTick)} }`,
    );
  }

  for (const [index, command] of domain.commands.entries()) {
    if (
      domain.machines.some((machine) =>
        machine.transitions.some((transition) => transition.command === command.name),
      )
    )
      continue;

    const frames = domain.machines.map(
      (_, machine) => `Machine${machine}.current${machine}' = Machine${machine}.current${machine}`,
    );

    lines.push(
      `pred stepCommand${index}[p: Principal, t: Target] { ${conjunction([`command${index}[p, t]`, "Membership' = Membership", adminFrame(command.name), clockStay, ...frames])} }`,
    );
    stepPredicates.push(`(some p: Principal, t: Target | stepCommand${index}[p, t])`);
  }

  const timeFrames = domain.machines.map(
    (_, machine) => `Machine${machine}.current${machine}' = Machine${machine}.current${machine}`,
  );

  const adminExpiry = domain.adminList?.expiry;

  const adminContext =
    adminExpiry === undefined
      ? -1
      : domain.machines.findIndex((machine) => machine.context.name === adminExpiry.context);

  const adminCondition =
    adminContext < 0
      ? undefined
      : clockedCondition(
          adminContext,
          adminExpiry,
          "next",
          "admin expiry lacks a clock-bound guard",
        );

  if (
    (domain.adminList !== undefined ||
      domain.subjectSets.some((subject) => subject.expression._tag === "Admin")) &&
    adminCondition === undefined
  ) {
    nondeterministic.add("admin expiry lacks a clock-bound guard");
  }

  const expiryFrame =
    adminCondition?.bound === true
      ? `(no Admin - Admin' or (some ctx: Context${adminContext} | ${adminCondition.expression}))`
      : yes;

  const calculatedFrame = `(${disjunction(tickChanges)} implies (Membership' = Membership and Admin' = Admin))`;

  const advancingTime = conjunction([
    clockAdvance,
    "Membership' in Membership",
    "Admin' in Admin",
    expiryFrame,
    ...tickRules,
    calculatedFrame,
  ]);

  const stutteringTime = conjunction([
    clockStay,
    "Membership' = Membership",
    "Admin' = Admin",
    ...timeFrames,
  ]);

  lines.push(
    `pred timeStep { ${disjunction([advancingTime, stutteringTime])} }`,
    `fact Dynamics { always (${disjunction(["timeStep", ...stepPredicates])}) }`,
  );

  const viewFields = [
    "var allowed: Principal -> Permission -> Target",
    "principals: set Principal",
    "persons: set Person",
    "systems: set System",
    "targets: set Target",
    "departments: set Department",
    "teams: set Team",
    "memberships: set MembershipRecord",
    "targetOwner: Target -> Person",
    "targetDept: Target -> Department",
    "teamFunctionView: Team -> TeamFunction",
    "teamDept: Team -> Department",
    "memberPerson: MembershipRecord -> Person",
    "memberTeam: MembershipRecord -> Team",
    "memberPosition: MembershipRecord -> Position",
    "systemJob: System -> Job",
    "var activeMembers: set MembershipRecord",
    "var adminPeople: set Person",
    ...(clockIndex === undefined
      ? []
      : [`var clockNow: set Order${clockIndex}`, `var clockNext: set Order${clockIndex}`]),
    ...domain.orders.flatMap((_, index) => [
      `order${index}Values: set Order${index}`,
      `order${index}Before: Order${index} -> Order${index}`,
    ]),
    ...domain.machines.flatMap((machine, machineIndex) => [
      `contexts${machineIndex}: set Context${machineIndex}`,
      `var machineState${machineIndex}: set State${machineIndex}`,
      ...machine.context.fields.map(
        (field, fieldIndex) =>
          `var field${machineIndex}_${fieldIndex}: Context${machineIndex} -> Order${orderIndex.get(field.order)}`,
      ),
      `var enabledNow${machineIndex}: State${machineIndex} -> Context${machineIndex} -> Transition${machineIndex}`,
      `var enabledAfterTick${machineIndex}: State${machineIndex} -> Context${machineIndex} -> Transition${machineIndex}`,
    ]),
  ];

  const viewFacts = [
    "Projection.allowed = { p: Principal, c: Permission, t: Target | can[p, c, t] }",
    "Projection.principals = Principal",
    "Projection.persons = Person",
    "Projection.systems = System",
    "Projection.targets = Target",
    "Projection.departments = Department",
    "Projection.teams = Team",
    "Projection.memberships = MembershipRecord",
    "Projection.targetOwner = owner",
    "Projection.targetDept = targetDepartment",
    "Projection.teamFunctionView = teamFunction",
    "Projection.teamDept = department",
    "Projection.memberPerson = member",
    "Projection.memberTeam = team",
    "Projection.memberPosition = position",
    "Projection.systemJob = job",
    "Projection.activeMembers = Membership",
    "Projection.adminPeople = Admin",
    ...(clockIndex === undefined
      ? []
      : [
          "Projection.clockNow = Clock.now",
          `Projection.clockNext = Ordering${clockIndex}/next[Clock.now]`,
        ]),
    ...domain.orders.flatMap((_, index) => [
      `Projection.order${index}Values = Order${index}`,
      `Projection.order${index}Before = { a, b: Order${index} | Ordering${index}/lt[a, b] }`,
    ]),
    ...domain.machines.flatMap((machine, machineIndex) => [
      `Projection.contexts${machineIndex} = Context${machineIndex}`,
      `Projection.machineState${machineIndex} = Machine${machineIndex}.current${machineIndex}`,
      ...machine.context.fields.map(
        (_, fieldIndex) =>
          `Projection.field${machineIndex}_${fieldIndex} = ctx${machineIndex}f${fieldIndex}`,
      ),
    ]),
    ...enabled,
  ];

  lines.push(
    `one sig Projection { ${viewFields.join(", ")} }`,
    `fact ProjectionFacts { always ${conjunction(viewFacts)} }`,
  );
  staticLines.push(
    `one sig Projection { ${viewFields.map((field) => (field.startsWith("var ") ? field.slice(4) : field)).join(", ")} }`,
    `fact ProjectionFacts { ${conjunction(viewFacts)} }`,
  );

  const initial = conjunction(
    domain.machines.map((_, index) => `no Machine${index}.current${index}`),
  );

  const reachability = domain.machines.flatMap((machine, machineIndex) =>
    machine.states.map((_, stateIndex) => ({
      name: `Reach${machineIndex}_${stateIndex}`,
      predicate: `pred Reach${machineIndex}_${stateIndex} { ${initial} and eventually (Machine${machineIndex}.current${machineIndex} = State${machineIndex}_${stateIndex}) }`,
    })),
  );

  const a2 = domain.machines.map((machine, index) => {
    const nonterminal = machine.states.filter((state) => !machine.terminal.includes(state));

    return conjunction(
      nonterminal.map(
        (state) => `some ${stateName(index, machine.states, state)}.${edgeNames[index]}`,
      ),
    );
  });

  const a4 =
    domain.adminList === undefined
      ? undefined
      : conjunction([
          `not can[p, Permission${permissionIndex.get(domain.adminList.grant)}, t]`,
          `not can[p, Permission${permissionIndex.get(domain.adminList.revoke)}, t]`,
        ]);

  const a6 = jobs.map((job) => {
    const own = domain.commands
      .filter((command) => command.runBy?.job === job.name)
      .map((command) => `c = Permission${permissionIndex.get(command.name)}`);

    return `all p: System, t: Target | p.job = ${job.atom} implies (all c: Permission | can[p, c, t] iff ${disjunction(own)})`;
  });

  lines.push(
    ...reachability.map((entry) => entry.predicate),
    `assert A2_NonterminalExit { ${conjunction(a2)} }`,
    `assert A3_CommandGrant { ${conjunction(coverage)} }`,
    ...(a4 === undefined
      ? ["// A4_AdminSelfChange: not applicable (no adminList declaration)"]
      : [
          `assert A4_AdminSelfChange { always (all p: Person, t: Target | (p not in Admin and t.owner = p) implies ${a4}) }`,
        ]),
    "assert A5_EndedMembership { always (all m: MembershipRecord - Membership, p: Principal, c: Permission, t: Target | not canByMembership[m, p, c, t]) }",
    `assert A6_SystemJob { always ${conjunction(a6)} }`,
    ...(clockIndex === undefined
      ? ["// A7_TimeMonotonic: not applicable (no clock declaration)"]
      : [
          `assert A7_TimeMonotonic { always (Clock.now' = Clock.now or Ordering${clockIndex}/lt[Clock.now, Clock.now']) }`,
        ]),
    "pred MembershipEnds { some m: Membership | after (m not in Membership) }",
  );

  const scopeParts = [
    `${2 * scope + 1} Principal`,
    `exactly ${permissions.length} Permission`,
    `exactly ${jobs.length} Job`,
    `exactly ${functions.length} TeamFunction`,
    `exactly ` + positions.length + " Position",
    `exactly ` + domain.subjectSets.length + " Subject",
    `exactly ` + domain.grants.length + " GrantRow",
    ...domain.orders.map((_, index) => `exactly ${orderedAtoms} Order${index}`),
    ...domain.machines.flatMap((machine, index) => [
      `exactly ${machine.states.length + 1} State${index}`,
      `exactly ${machineSymbols[index]!.transitions.length} Transition${index}`,
    ]),
  ];

  const scopes = scopeParts.join(", ");
  const staticBound = `for ${scope} but ${scopes}`;
  lines[1] = `// domain ${JSON.stringify(domain.name)}; scope ${scope}; steps ${steps}; ${scopes}`;
  staticLines[1] = `// domain ${JSON.stringify(domain.name)}; static scope ${scope}; ${scopes}`;
  const bound = `${staticBound}, 1..${steps} steps`;
  lines.push(
    ...reachability.map((entry) => `run ${entry.name} ${bound}`),
    `check A2_NonterminalExit ${bound}`,
    `check A3_CommandGrant ${bound}`,
    ...(a4 === undefined ? [] : [`check A4_AdminSelfChange ${bound}`]),
    `check A5_EndedMembership ${bound}`,
    `check A6_SystemJob ${bound}`,
    ...(clockIndex === undefined ? [] : [`check A7_TimeMonotonic ${bound}`]),
    `run MembershipEnds ${bound}`,
  );
  staticLines.push("pred Vectors {}", `run Vectors ${staticBound}`, "");

  const unknownGuards = [...unknown].toSorted();

  const symbols: AlloySymbols = {
    domain: domain.name,
    scope,
    steps,
    orderedAtoms,
    scopeParts,
    permissions,
    jobs,
    functions,
    positions,
    orders: domain.orders.map((order, index) => ({ name: order.name, atom: `Order${index}` })),
    machines: machineSymbols,
    adminApplicable: domain.adminList !== undefined,
    unknownGuards,
    clock: domain.clock ?? null,
    nondeterministic: [...nondeterministic].toSorted(),
  };

  const metadata = `// effx-model-metadata ${encodeSymbols(symbols)}`;
  lines.push(metadata, "");
  staticLines.push(metadata, "");

  return { source: lines.join("\n"), staticSource: staticLines.join("\n"), symbols, unknownGuards };
};
