import { Predicate, SchemaAST } from "effect";
import type { Plan } from "./plan.js";

/**
 * `A.fromSchema` (spec 0020 §2.2): the plan of a transformation-free Effect Schema, built by walking its AST.
 *
 * Accepted: `String` (`isNonEmpty`/`isMinLength(1)`), `Number` (`isInt`, `isFinite`), `Boolean`, `Literal`s,
 * `Struct` with `optionalKey`, `Record(String, …)`, `Array` (`isMinLength(1)`, `isUnique`, `NonEmptyArray`),
 * unions of literals, tagged unions, `Json`/`JsonObject`. A refinement check the algebra has no name for
 * (`isMaxLength`, `makeFilter`, …) is kept as a `Refine` wrapper and runs in the compiler's `decodeResult`.
 *
 * Rejected, each as an `Invalid` leaf carrying its node kind: `Class` and other `Declaration`s
 * (`Date`, `Option`, …), `BigInt`, `Symbol`, `Unknown`, `Any`, `ObjectKeyword`, `Suspend`, `Null`/`Undefined`,
 * `Enum`, `TemplateLiteral`, tuples, and every node with an `encoding` (`NumberFromString`, `decodeTo`,
 * `transform`, `transformOrFail`): the value written in source would not be the value `read` sees.
 * `Schema.Opaque` leaves no trace in the AST (it is its underlying schema at runtime), so it is accepted
 * exactly when that schema is.
 *
 * `define` turns each `Invalid` leaf into an `EFFX1301` diagnostic that names the node kind and its path
 * from the argument list (`invalidLeaves`): `$[i]` the ith argument, `.field` an object field, `[]` an
 * array item, `[*]` a record value, `|n` the nth member of a union, `<Tag>.field` a tagged-union case field.
 *
 * A pure, total function: it never throws and never evaluates a Schema.
 */

type Check = SchemaAST.Check<unknown>;

type PlanOf<Tag extends Plan["_tag"]> = Extract<Plan, { readonly _tag: Tag }>;

type Draft<T> = { -readonly [K in keyof T]: T[K] };

const invalid = (kind: string): Plan => ({ _tag: "Invalid", kind });

const representationId = (check: Check): string | undefined =>
  check.annotations?.representation?.id;

/** The `representation.id` of a `Declaration` (`effect/schema/Json`, `effect/schema/Date`, …). */
const declarationId = (ast: SchemaAST.Declaration): string | undefined => {
  const representation = ast.annotations?.representation;

  return Predicate.hasProperty(representation, "id") && Predicate.isString(representation.id)
    ? representation.id
    : undefined;
};

const isMinLengthOne = (check: Check): boolean => {
  const payload = check.annotations?.representation?.payload;

  return (
    representationId(check) === "effect/schema/isMinLength" &&
    Predicate.hasProperty(payload, "minLength") &&
    payload.minLength === 1
  );
};

const isUniqueCheck = (check: Check): boolean =>
  representationId(check) === "effect/schema/isUnique";

const isIntCheck = (check: Check): boolean => representationId(check) === "effect/schema/isInt";

const isFiniteCheck = (check: Check): boolean =>
  representationId(check) === "effect/schema/isFinite";

/** The checks of `ast` that none of the recognized checks claims; they become the `Refine` wrapper. */
const refine = (
  ast: SchemaAST.AST,
  plan: Plan,
  ...recognized: ReadonlyArray<(c: Check) => boolean>
): Plan => {
  const [first, ...rest] = (ast.checks ?? []).filter(
    (check) => !recognized.some((claims) => claims(check)),
  );

  return first === undefined ? plan : { _tag: "Refine", plan, checks: [first, ...rest] };
};

const declarationKind = (ast: SchemaAST.Declaration): string => {
  if (ast.encoding !== undefined) return "Class";

  return declarationId(ast) === "effect/schema/Date" ? "Date" : "Declaration";
};

interface TaggedCase {
  readonly tag: string;
  readonly fields: ReadonlyArray<SchemaAST.PropertySignature>;
}

/** A `{ _tag: "X", ...required fields }` struct: the shape `Schema.TaggedUnion` and `A.taggedUnion` share. */
const taggedCase = (ast: SchemaAST.AST): TaggedCase | undefined => {
  if (!SchemaAST.isObjects(ast) || ast.checks !== undefined || ast.encoding !== undefined)
    return undefined;

  if (ast.indexSignatures.length > 0) return undefined;

  const tagType = ast.propertySignatures.find((field) => field.name === "_tag")?.type;

  if (
    tagType === undefined ||
    !SchemaAST.isLiteral(tagType) ||
    !Predicate.isString(tagType.literal) ||
    SchemaAST.isOptional(tagType)
  )
    return undefined;

  const fields = ast.propertySignatures.filter((field) => field.name !== "_tag");

  // The TaggedUnion plan has no per-field optionality, so a case with an optional field stays a plain union.
  if (fields.some((field) => SchemaAST.isOptional(field.type) || !Predicate.isString(field.name)))
    return undefined;

  return { tag: tagType.literal, fields };
};

const walkObjects = (ast: SchemaAST.Objects): Plan => {
  const properties = ast.propertySignatures;
  const [index, ...moreIndexes] = ast.indexSignatures;

  if (index !== undefined) {
    if (properties.length > 0) return invalid("StructWithRest");

    if (moreIndexes.length > 0) return invalid("Objects");

    if (!SchemaAST.isString(index.parameter) || index.parameter.checks !== undefined)
      return invalid("Record");

    const value = walk(index.type);

    return refine(ast, value._tag === "Json" ? { _tag: "JsonObject" } : { _tag: "Record", value });
  }

  const fields: Record<string, Plan> = {};
  const optional: Array<string> = [];

  for (const property of properties) {
    if (!Predicate.isString(property.name)) return invalid("Symbol");

    fields[property.name] = walk(property.type);

    if (SchemaAST.isOptional(property.type)) optional.push(property.name);
  }

  return refine(ast, { _tag: "Struct", fields, optional });
};

const walkArrays = (ast: SchemaAST.Arrays): Plan => {
  const [element] = ast.elements;
  const [rest] = ast.rest;

  // `Schema.NonEmptyArray(item)` is `[item, ...item[]]`.
  const headAndRest = ast.elements.length === 1 && ast.rest.length === 1 && element === rest;
  const restOnly = ast.elements.length === 0 && ast.rest.length === 1;

  if (rest === undefined || !(restOnly || headAndRest)) return invalid("Tuple");

  const checks = ast.checks ?? [];
  const plan: Draft<PlanOf<"Array">> = { _tag: "Array", item: walk(rest) };

  if (headAndRest || checks.some(isMinLengthOne)) plan.nonEmpty = true;

  if (checks.some(isUniqueCheck)) plan.unique = true;

  return refine(ast, plan, isMinLengthOne, isUniqueCheck);
};

const walkUnion = (ast: SchemaAST.Union): Plan => {
  const members = ast.types.map(walk);
  const values = members.flatMap((member) => (member._tag === "Literal" ? member.values : []));

  if (members.length > 0 && values.length === members.length)
    return refine(ast, { _tag: "Literal", values });

  const cases = ast.types.map(taggedCase);
  const byTag: Record<string, Record<string, Plan>> = {};

  for (const item of cases) {
    if (item === undefined || Object.hasOwn(byTag, item.tag))
      return refine(ast, { _tag: "Union", members });

    byTag[item.tag] = Object.fromEntries(
      item.fields.map((field) => [String(field.name), walk(field.type)]),
    );
  }

  return refine(
    ast,
    cases.length === 0 ? { _tag: "Union", members } : { _tag: "TaggedUnion", cases: byTag },
  );
};

const walk = (ast: SchemaAST.AST): Plan => {
  if (SchemaAST.isDeclaration(ast)) {
    const id = declarationId(ast);

    return ast.encoding === undefined &&
      (id === "effect/schema/Json" || id === "effect/schema/MutableJson")
      ? refine(ast, { _tag: "Json" })
      : invalid(declarationKind(ast));
  }

  if (ast.encoding !== undefined) return invalid("Transformation");

  switch (ast._tag) {
    case "String": {
      const plan: Draft<PlanOf<"String">> = { _tag: "String" };

      if (ast.checks?.some(isMinLengthOne) === true) plan.nonEmpty = true;

      return refine(ast, plan, isMinLengthOne);
    }

    case "Number":
      return refine(
        ast,
        { _tag: ast.checks?.some(isIntCheck) === true ? "Int" : "Number" },
        isIntCheck,
        isFiniteCheck,
      );
    case "Boolean":
      return refine(ast, { _tag: "Boolean" });
    case "Literal":
      return Predicate.isBigInt(ast.literal)
        ? invalid("BigInt")
        : refine(ast, { _tag: "Literal", values: [ast.literal] });
    case "Objects":
      return walkObjects(ast);
    case "Arrays":
      return walkArrays(ast);
    case "Union":
      return walkUnion(ast);
    default:
      return invalid(ast._tag);
  }
};

/** The plan of `ast`; rejected nodes become `Invalid` leaves (see the module comment). */
export const planOfSchemaAst = (ast: SchemaAST.AST): Plan => walk(ast);

export interface InvalidLeaf {
  /** From the argument list: `$[0].items[].at`. */
  readonly path: string;
  readonly kind: string;
}

/** Every `Invalid` leaf of `plan`, each path prefixed with `path` (`define` collects these as EFFX1301). */
export const invalidLeaves = (plan: Plan, path: string): ReadonlyArray<InvalidLeaf> => {
  switch (plan._tag) {
    case "Invalid":
      return [{ path, kind: plan.kind }];
    case "Struct":
      return Object.entries(plan.fields).flatMap(([key, field]) =>
        invalidLeaves(field, `${path}.${key}`),
      );
    case "Array":
      return invalidLeaves(plan.item, `${path}[]`);
    case "Record":
      return invalidLeaves(plan.value, `${path}[*]`);
    case "Union":
      return plan.members.flatMap((member, i) => invalidLeaves(member, `${path}|${i}`));
    case "TaggedUnion":
      return Object.entries(plan.cases).flatMap(([tag, fields]) =>
        Object.entries(fields).flatMap(([key, field]) =>
          invalidLeaves(field, `${path}<${tag}>.${key}`),
        ),
      );
    case "Refine":
    case "Injected":
      return invalidLeaves(plan.plan, path);
    default:
      return [];
  }
};
