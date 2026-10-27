import { Result, Schema } from "effect";
import {
  CheckRepresentation,
  type DomainDescription,
  type Guard,
  type SubjectExpression,
  type VectorSnapshot,
} from "@effx/domain-model";

/** Example-owned authorization, deliberately separate from the effx model generator. */
export const authorize = (
  domain: DomainDescription,
  snapshot: VectorSnapshot,
  principalId: string,
  permission: string,
  targetId: string,
): boolean => {
  const principal = snapshot.principals.find((item) => item.id === principalId);
  const target = snapshot.targets.find((item) => item.id === targetId);

  if (principal === undefined || target === undefined) return false;
  const subjects = new Map(domain.subjectSets.map((subject) => [subject.name, subject.expression]));

  const memberMatches = (
    expression: Extract<SubjectExpression, { readonly _tag: "Membership" }>,
  ): boolean =>
    snapshot.memberships.some((membership) => {
      const team = snapshot.teams.find((item) => item.id === membership.team);

      return (
        membership.person === principalId &&
        (expression.term === "any" || membership.active) &&
        (expression.function === undefined || team?.function === expression.function) &&
        (expression.position === undefined || membership.position === expression.position) &&
        (expression.department === "any" ||
          (target.department !== undefined && team?.department === target.department))
      );
    });

  const inSubject = (expression: SubjectExpression): boolean => {
    switch (expression._tag) {
      case "Membership":
        return memberMatches(expression);
      case "Self":
        return principalId === target.owner;
      case "Admin":
        return principal.admin;
      case "System":
        return principal.kind === "System" && principal.job === expression.job;
      case "Union":
        return expression.sets.some((name) => inSubject(subjects.get(name)!));
    }
  };

  return domain.grants.some((grant) => {
    if (!grant.permits.includes(permission) || !inSubject(subjects.get(grant.subject)!))
      return false;

    switch (grant.scope) {
      case "all":
        return true;
      case "own":
        return principalId === target.owner;
      case "department":
        return (
          target.department !== undefined &&
          snapshot.memberships.some(
            (membership) =>
              membership.person === principalId &&
              membership.active &&
              snapshot.teams.some(
                (team) => team.id === membership.team && team.department === target.department,
              ),
          )
        );
    }
  });
};

const decodeCheck = Schema.decodeUnknownResult(CheckRepresentation);

const decodeComparison = Schema.decodeUnknownResult(
  Schema.Struct({ left: Schema.Array(Schema.String), right: Schema.Array(Schema.String) }),
);

const decodeChecks = Schema.decodeUnknownResult(Schema.Array(Schema.Json));

const guardAllows = (
  guard: Guard | undefined,
  context: VectorSnapshot["contexts"][number],
  snapshot: VectorSnapshot,
  contextName: string,
): boolean => {
  if (guard === undefined) return true;

  const evaluate = (input: Schema.Json): boolean => {
    const decoded = decodeCheck(input);

    if (Result.isFailure(decoded)) return false;
    const check = decoded.success;

    if ("_tag" in check) {
      if (check._tag === "Filter")
        return check.representation !== undefined && evaluate(check.representation);

      return check.checks.every(evaluate);
    }

    if (check.id === "effx/guard/not") return !evaluate(check.payload);

    if (check.id === "effx/guard/or") {
      const children = decodeChecks(check.payload);

      return Result.isSuccess(children) && children.success.some(evaluate);
    }

    const comparison = decodeComparison(check.payload);

    if (Result.isFailure(comparison)) return false;

    const field = (path: ReadonlyArray<string>) =>
      context.values.find(
        (value) =>
          value.path.length === path.length &&
          value.path.every((segment, index) => segment === path[index]),
      );

    const left = field(comparison.success.left);
    const right = field(comparison.success.right);

    if (left === undefined || right === undefined || left.order !== right.order) return false;

    if (check.id === "effx/order/same") return left.value === right.value;

    if (check.id !== "effx/order/after") return false;

    return snapshot.orders.some(
      (order) =>
        order.name === left.order &&
        order.before.some(([earlier, later]) => earlier === right.value && later === left.value),
    );
  };

  return guard.context === contextName && evaluate(guard.representation);
};

/** Machine.can for the fixture, independent of the generated Alloy relation. */
export const machineCan = (
  domain: DomainDescription,
  snapshot: VectorSnapshot,
  machineName: string,
  state: string,
  contextId: string,
  transitionIndex: number,
  phase: "atNow" | "afterTick",
): boolean => {
  const machine = domain.machines.find((item) => item.name === machineName);

  const context = snapshot.contexts.find(
    (item) => item.machine === machineName && item.id === contextId,
  );

  if (machine === undefined || context === undefined) return false;
  const contextName = machine.context.name;
  const next = snapshot.clock?.afterTick;

  if (phase === "afterTick" && (next === undefined || next === null)) return false;
  const clockPath = machine.context.clockPath;

  const evaluated =
    phase === "afterTick" && clockPath !== undefined && next !== undefined && next !== null
      ? {
          ...context,
          values: context.values.map((field) =>
            field.path.length === clockPath.length &&
            field.path.every((part, index) => part === clockPath[index])
              ? { ...field, value: next }
              : field,
          ),
        }
      : context;

  const transition = machine.transitions[transitionIndex];

  if (transition !== undefined) {
    return (
      transition.from.includes(state) &&
      guardAllows(transition.when, evaluated, snapshot, contextName) &&
      guardAllows(transition.guard, evaluated, snapshot, contextName)
    );
  }

  const calculated = machine.calculated[transitionIndex - machine.transitions.length];

  return (
    calculated !== undefined &&
    calculated.from === state &&
    guardAllows(calculated.when, evaluated, snapshot, contextName)
  );
};
