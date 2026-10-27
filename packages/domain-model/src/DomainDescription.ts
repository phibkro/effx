import { Result, Schema } from "effect";

const Name = Schema.String;

/** A check representation as exported by Effect Schema, or its all-of FilterGroup. */
export const CheckRepresentation = Schema.Union([
  Schema.Struct({ id: Name, payload: Schema.Json }),
  Schema.TaggedStruct("Filter", {
    representation: Schema.optionalKey(Schema.Struct({ id: Name, payload: Schema.Json })),
  }),
  Schema.TaggedStruct("FilterGroup", { checks: Schema.Array(Schema.Json) }),
]);

export type CheckRepresentation = typeof CheckRepresentation.Type;

export const Guard = Schema.Struct({ context: Name, representation: CheckRepresentation });

export type Guard = typeof Guard.Type;

export const SubjectExpression = Schema.TaggedUnion({
  Membership: {
    function: Schema.optionalKey(Name),
    position: Schema.optionalKey(Name),
    department: Schema.Literals(["any", "target"]),
    term: Schema.Literals(["active", "any"]),
  },
  Self: {},
  Admin: {},
  System: { job: Name },
  Union: { sets: Schema.Array(Name) },
});

export type SubjectExpression = typeof SubjectExpression.Type;

export const SubjectSet = Schema.Struct({ name: Name, expression: SubjectExpression });

export const Command = Schema.Struct({
  name: Name,
  kind: Schema.Literal("Command"),
  runBy: Schema.optionalKey(Schema.Struct({ job: Name })),
  writes: Schema.optionalKey(
    Schema.Array(Schema.Struct({ machine: Name, path: Schema.Array(Name) })),
  ),
});

export const Read = Schema.Struct({ name: Name });

export const Grant = Schema.Struct({
  subject: Name,
  permits: Schema.Array(Name),
  scope: Schema.Literals(["all", "department", "own"]),
});

export const MachineContext = Schema.Struct({
  name: Name,
  fields: Schema.Array(
    Schema.Struct({
      path: Schema.Array(Name),
      order: Name,
      kind: Schema.Literals(["stored", "parameter", "clock"]),
    }),
  ),
  clockPath: Schema.optionalKey(Schema.Array(Name)),
});

export const Transition = Schema.Struct({
  command: Name,
  from: Schema.Array(Name),
  to: Name,
  when: Schema.optionalKey(Guard),
  guard: Schema.optionalKey(Guard),
});

export const CalculatedTransition = Schema.Struct({
  from: Name,
  to: Name,
  when: Schema.optionalKey(Guard),
});

export const Machine = Schema.Struct({
  name: Name,
  states: Schema.Array(Name),
  terminal: Schema.Array(Name),
  context: MachineContext,
  transitions: Schema.Array(Transition),
  calculated: Schema.Array(CalculatedTransition),
});

export const DescriptionFields = Schema.Struct({
  name: Name,
  commands: Schema.Array(Command),
  reads: Schema.Array(Read),
  principals: Schema.Struct({
    Anonymous: Schema.Struct({}),
    Person: Schema.Struct({}),
    System: Schema.Struct({ jobs: Schema.Array(Name) }),
  }),
  subjectSets: Schema.Array(SubjectSet),
  grants: Schema.Array(Grant),
  machines: Schema.Array(Machine),
  orders: Schema.Array(Schema.Struct({ name: Name })),
  memberships: Schema.optionalKey(
    Schema.Struct({ machine: Name, grantingStates: Schema.Array(Name) }),
  ),
  clock: Schema.optionalKey(Schema.Struct({ order: Name })),
  adminList: Schema.optionalKey(
    Schema.Struct({ grant: Name, revoke: Name, expiry: Schema.optionalKey(Guard) }),
  ),
});

type DescriptionFields = typeof DescriptionFields.Type;

const decodeCheck = Schema.decodeUnknownResult(CheckRepresentation);

const decodeComparison = Schema.decodeUnknownResult(
  Schema.Struct({ left: Schema.Array(Name), right: Schema.Array(Name) }),
);

const decodeChecks = Schema.decodeUnknownResult(Schema.Array(Schema.Json));

const pathKey = (path: ReadonlyArray<string>): string => JSON.stringify(path);

const guardIssues = (
  guard: Guard,
  context: typeof MachineContext.Type,
  path: ReadonlyArray<PropertyKey>,
): ReadonlyArray<Schema.FilterIssue> => {
  const issues: Array<Schema.FilterIssue> = [];

  if (guard.context !== context.name) {
    issues.push({ path, issue: `unknown guard context ${guard.context}` });
  }

  const fields = new Map(context.fields.map((field) => [pathKey(field.path), field.order]));

  const visit = (value: Schema.Json): void => {
    const decoded = decodeCheck(value);

    if (Result.isFailure(decoded)) {
      issues.push({ path, issue: "invalid nested check representation" });

      return;
    }

    const check = decoded.success;

    if ("_tag" in check) {
      if (check._tag === "FilterGroup") for (const child of check.checks) visit(child);
      else if (check.representation !== undefined) visit(check.representation);

      return;
    }

    if (check.id === "effx/guard/not") {
      visit(check.payload);

      return;
    }

    if (check.id === "effx/guard/or") {
      const children = decodeChecks(check.payload);

      if (Result.isFailure(children)) issues.push({ path, issue: "invalid or payload" });
      else for (const child of children.success) visit(child);

      return;
    }

    if (check.id !== "effx/order/after" && check.id !== "effx/order/same") return;
    const comparison = decodeComparison(check.payload);

    if (Result.isFailure(comparison)) {
      issues.push({ path, issue: `invalid ${check.id} payload` });

      return;
    }

    const left = fields.get(pathKey(comparison.success.left));
    const right = fields.get(pathKey(comparison.success.right));

    if (left === undefined)
      issues.push({ path, issue: `unknown context path ${pathKey(comparison.success.left)}` });

    if (right === undefined)
      issues.push({ path, issue: `unknown context path ${pathKey(comparison.success.right)}` });

    if (left !== undefined && right !== undefined && left !== right) {
      issues.push({ path, issue: "compared context paths use different orders" });
    }
  };

  visit(guard.representation);

  return issues;
};

const referenceIssues = (domain: DescriptionFields): ReadonlyArray<Schema.FilterIssue> => {
  const issues: Array<Schema.FilterIssue> = [];

  const unique = (names: ReadonlyArray<string>, path: ReadonlyArray<PropertyKey>): void => {
    const seen = new Set<string>();

    for (const name of names) {
      if (seen.has(name)) issues.push({ path, issue: `duplicate name ${name}` });
      seen.add(name);
    }
  };

  const commandNames = new Set(domain.commands.map((command) => command.name));
  const permissions = new Set([...commandNames, ...domain.reads.map((read) => read.name)]);
  const subjects = new Map(domain.subjectSets.map((subject) => [subject.name, subject.expression]));
  const jobs = new Set(domain.principals.System.jobs);
  const orders = new Set(domain.orders.map((order) => order.name));
  unique(
    [...domain.commands.map((item) => item.name), ...domain.reads.map((item) => item.name)],
    ["commands"],
  );
  unique(
    domain.subjectSets.map((item) => item.name),
    ["subjectSets"],
  );
  unique(
    domain.machines.map((item) => item.name),
    ["machines"],
  );
  unique(
    domain.orders.map((item) => item.name),
    ["orders"],
  );
  unique(domain.principals.System.jobs, ["principals", "System", "jobs"]);

  for (const [index, command] of domain.commands.entries()) {
    if (command.runBy !== undefined && !jobs.has(command.runBy.job)) {
      issues.push({
        path: ["commands", index, "runBy"],
        issue: `unknown job ${command.runBy.job}`,
      });
    }

    for (const [writeIndex, write] of (command.writes ?? []).entries()) {
      const machine = domain.machines.find((item) => item.name === write.machine);

      const field = machine?.context.fields.find(
        (item) => pathKey(item.path) === pathKey(write.path),
      );

      if (field?.kind !== "stored")
        issues.push({
          path: ["commands", index, "writes", writeIndex],
          issue: `unknown stored field ${write.machine}:${pathKey(write.path)}`,
        });
    }
  }

  if (domain.clock !== undefined && !orders.has(domain.clock.order)) {
    issues.push({ path: ["clock", "order"], issue: `unknown order ${domain.clock.order}` });
  }

  if (domain.memberships !== undefined) {
    const machine = domain.machines.find((item) => item.name === domain.memberships!.machine);

    if (machine === undefined)
      issues.push({
        path: ["memberships", "machine"],
        issue: `unknown machine ${domain.memberships.machine}`,
      });
    else
      for (const state of domain.memberships.grantingStates)
        if (!machine.states.includes(state))
          issues.push({
            path: ["memberships", "grantingStates"],
            issue: `unknown granting state ${state}`,
          });
    unique(domain.memberships.grantingStates, ["memberships", "grantingStates"]);
  }

  if (domain.adminList !== undefined) {
    for (const key of ["grant", "revoke"] as const) {
      if (!commandNames.has(domain.adminList[key])) {
        issues.push({
          path: ["adminList", key],
          issue: `unknown command ${domain.adminList[key]}`,
        });
      }
    }

    if (domain.adminList.expiry !== undefined) {
      const context = domain.machines.find(
        (machine) => machine.context.name === domain.adminList!.expiry!.context,
      )?.context;

      if (context === undefined || context.clockPath === undefined || domain.clock === undefined) {
        issues.push({
          path: ["adminList", "expiry"],
          issue: "expiry requires a clock-bound context",
        });
      } else {
        issues.push(...guardIssues(domain.adminList.expiry, context, ["adminList", "expiry"]));
      }
    }
  }

  for (const [index, subject] of domain.subjectSets.entries()) {
    const expression = subject.expression;

    if (expression._tag === "System" && !jobs.has(expression.job)) {
      issues.push({ path: ["subjectSets", index], issue: `unknown job ${expression.job}` });
    }

    if (expression._tag === "Union")
      for (const name of expression.sets) {
        if (!subjects.has(name))
          issues.push({ path: ["subjectSets", index], issue: `unknown subject set ${name}` });
      }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visitSubject = (name: string): void => {
    if (visiting.has(name)) {
      issues.push({ path: ["subjectSets"], issue: `cyclic subject set ${name}` });

      return;
    }

    if (visited.has(name)) return;
    visiting.add(name);
    const expression = subjects.get(name);

    if (expression?._tag === "Union") for (const member of expression.sets) visitSubject(member);
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of subjects.keys()) visitSubject(name);

  for (const [index, grant] of domain.grants.entries()) {
    if (!subjects.has(grant.subject))
      issues.push({
        path: ["grants", index, "subject"],
        issue: `unknown subject set ${grant.subject}`,
      });

    for (const permission of grant.permits) {
      if (!permissions.has(permission))
        issues.push({
          path: ["grants", index, "permits"],
          issue: `unknown permission ${permission}`,
        });
    }
  }

  for (const [index, machine] of domain.machines.entries()) {
    const prefix = ["machines", index] as const;
    const states = new Set(machine.states);

    if (states.has("[*]"))
      issues.push({
        path: [...prefix, "states"],
        issue: "[*] is reserved for the initial or removed state",
      });
    unique(machine.states, [...prefix, "states"]);
    unique(machine.terminal, [...prefix, "terminal"]);
    unique(
      machine.context.fields.map((field) => pathKey(field.path)),
      [...prefix, "context", "fields"],
    );

    for (const [fieldIndex, field] of machine.context.fields.entries()) {
      if (!orders.has(field.order))
        issues.push({
          path: [...prefix, "context", "fields", fieldIndex],
          issue: `unknown order ${field.order}`,
        });

      if (
        field.kind === "clock" &&
        (domain.clock === undefined ||
          field.order !== domain.clock.order ||
          machine.context.clockPath === undefined ||
          pathKey(field.path) !== pathKey(machine.context.clockPath))
      ) {
        issues.push({
          path: [...prefix, "context", "fields", fieldIndex],
          issue: "clock field must be the declared clock path of the domain clock order",
        });
      }
    }

    if (machine.context.clockPath !== undefined) {
      const clockField = machine.context.fields.find(
        (field) => pathKey(field.path) === pathKey(machine.context.clockPath!),
      );

      if (
        domain.clock === undefined ||
        clockField === undefined ||
        clockField.order !== domain.clock.order ||
        clockField.kind !== "clock"
      ) {
        issues.push({
          path: [...prefix, "context", "clockPath"],
          issue: "clock path must name a field of the domain clock order",
        });
      }
    }

    for (const state of machine.terminal) {
      if (!states.has(state))
        issues.push({ path: [...prefix, "terminal"], issue: `unknown state ${state}` });
    }

    const stateReference = (state: string, path: ReadonlyArray<PropertyKey>): void => {
      if (state !== "[*]" && !states.has(state))
        issues.push({ path, issue: `unknown state ${state}` });
    };

    for (const [transitionIndex, transition] of machine.transitions.entries()) {
      const path = [...prefix, "transitions", transitionIndex];

      if (!commandNames.has(transition.command))
        issues.push({ path, issue: `unknown command ${transition.command}` });

      for (const state of transition.from) stateReference(state, path);
      stateReference(transition.to, path);

      if (transition.when !== undefined)
        issues.push(...guardIssues(transition.when, machine.context, path));

      if (transition.guard !== undefined)
        issues.push(...guardIssues(transition.guard, machine.context, path));
    }

    for (const [transitionIndex, transition] of machine.calculated.entries()) {
      const path = [...prefix, "calculated", transitionIndex];
      stateReference(transition.from, path);
      stateReference(transition.to, path);

      if (transition.when !== undefined)
        issues.push(...guardIssues(transition.when, machine.context, path));
    }
  }

  return issues;
};

/** The config boundary decodes names and cross-references before they enter the IR. */
export const DomainDescription = DescriptionFields.check(Schema.makeFilter(referenceIssues));

export type DomainDescription = typeof DomainDescription.Type;
