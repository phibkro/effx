/**
 * PII-minimized relation rows accepted at the domain package boundary.
 *
 * Effect Schema owns each decoded row boundary. Array shape is checked without
 * copying rows so per-row Schema failures retain deterministic source indexes;
 * names, emails, descriptions, and person payloads never enter the core.
 */

import { Data, flow, Match, Predicate, Result, Schema, SchemaAST, SchemaIssue } from "effect";

export type SchemaFailureCode =
  | "ROW_NOT_OBJECT"
  | "UNEXPECTED_FIELD"
  | "MISSING_FIELD"
  | "INVALID_INTEGER"
  | "INVALID_NULLABLE_INTEGER"
  | "INVALID_BOOLEAN"
  | "INVALID_STRING";

export class SchemaInputError extends Data.TaggedError("SchemaInputError")<{
  readonly file: string;
}> {
  readonly code = "INVALID_ARRAY";
  override readonly message = "input file must contain a JSON array";
}

export interface DecodeFailure {
  readonly file: string;
  readonly index: number;
  readonly code: SchemaFailureCode;
  readonly message: string;
}

export type DecodeResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly failure: Omit<DecodeFailure, "file" | "index"> };

export interface DepartmentRow {
  readonly id: number;
}

export interface TeamRow {
  readonly id: number;
  readonly departmentId: number | null;
}

export interface TeamMembershipRow {
  readonly id: number;
  readonly userId: number;
  readonly teamId: number | null;
}

export interface GlobalContainerRow {
  readonly id: number;
}

export interface GlobalMembershipRow {
  readonly id: number;
  readonly userId: number;
  readonly boardId: number | null;
}

const BooleanFlag = Schema.Union([Schema.Boolean, Schema.Literals([0, 1])]);

const OptionalNullableInteger = Schema.optional(Schema.NullOr(Schema.Int));

const OptionalBooleanFlag = Schema.optional(BooleanFlag);

type IssueNode = {
  readonly tag: SchemaIssue.Issue["_tag"];
  readonly path: ReadonlyArray<PropertyKey>;
  readonly ast?: SchemaAST.AST;
};

const astForIssue = (
  issue: SchemaIssue.Issue,
  fallback: SchemaAST.AST | undefined,
): SchemaAST.AST | undefined => {
  return Match.value(issue).pipe(
    Match.withReturnType<SchemaAST.AST | undefined>(),
    Match.tag(
      "Composite",
      "AnyOf",
      "Encoding",
      "InvalidType",
      "UnexpectedKey",
      "OneOf",
      (issue) => {
        return issue.ast;
      },
    ),
    Match.orElse(() => {
      return fallback;
    }),
  );
};

const collectIssueNodes = (
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
  nodes: IssueNode[] = [],
  astContext?: SchemaAST.AST,
): ReadonlyArray<IssueNode> => {
  const ast = astForIssue(issue, astContext);
  nodes.push({ tag: issue._tag, path, ast });

  Match.value(issue).pipe(
    Match.tag("Pointer", (issue) => {
      collectIssueNodes(issue.issue, [...path, ...issue.path], nodes, ast);
    }),
    Match.tag("Composite", "AnyOf", (issue) => {
      for (const child of issue.issues) collectIssueNodes(child, path, nodes, ast);
    }),
    Match.tag("Filter", "Encoding", (issue) => {
      collectIssueNodes(issue.issue, path, nodes, ast);
    }),
    Match.orElse(() => {}),
  );

  return nodes;
};

type AstPrimitives = {
  hasIntegerNumber: boolean;
  hasNull: boolean;
  hasBoolean: boolean;
  hasString: boolean;
};

const inspectAstPrimitives = (
  ast: SchemaAST.AST,
  primitives: AstPrimitives,
  seen: Set<SchemaAST.AST>,
): void => {
  if (seen.has(ast)) return;
  seen.add(ast);

  Match.value(ast).pipe(
    Match.tag("Number", (ast) => {
      if (ast.checks?.some((check) => Predicate.isTagged(check, "Filter")))
        primitives.hasIntegerNumber = true;
    }),
    Match.tag("Null", () => {
      primitives.hasNull = true;
    }),
    Match.tag("Boolean", () => {
      primitives.hasBoolean = true;
    }),
    Match.tag("String", () => {
      primitives.hasString = true;
    }),
    Match.tag("Union", (ast) => {
      for (const member of ast.types) inspectAstPrimitives(member, primitives, seen);
    }),
    Match.tag("Objects", (ast) => {
      for (const property of ast.propertySignatures)
        inspectAstPrimitives(property.type, primitives, seen);
    }),
    Match.tag("Arrays", (ast) => {
      for (const element of ast.elements) inspectAstPrimitives(element, primitives, seen);

      for (const rest of ast.rest) inspectAstPrimitives(rest, primitives, seen);
    }),
    Match.tag("Declaration", (ast) => {
      for (const parameter of ast.typeParameters) inspectAstPrimitives(parameter, primitives, seen);
    }),
    Match.tag("Suspend", (ast) => {
      inspectAstPrimitives(ast.thunk(), primitives, seen);
    }),
    Match.orElse(() => {}),
  );

  if (ast.encoding !== undefined) {
    for (const link of ast.encoding) inspectAstPrimitives(link.to, primitives, seen);
  }
};

const astAtPath = (
  ast: SchemaAST.AST | undefined,
  path: ReadonlyArray<PropertyKey>,
): SchemaAST.AST | undefined => {
  let current = ast;

  for (const segment of path) {
    if (current === undefined || !SchemaAST.isObjects(current)) return undefined;
    const property = current.propertySignatures.find((candidate) => candidate.name === segment);

    if (property === undefined) return undefined;
    current = property.type;
  }

  return current;
};

const issuePrimitives = (nodes: ReadonlyArray<IssueNode>): AstPrimitives => {
  const primitives: AstPrimitives = {
    hasIntegerNumber: false,
    hasNull: false,
    hasBoolean: false,
    hasString: false,
  };

  const rootAst = nodes.find((node) => node.path.length === 0)?.ast;
  const fieldNode = nodes.find((node) => node.path.length > 0);

  const fieldAst =
    fieldNode === undefined
      ? undefined
      : rootAst === undefined
        ? fieldNode.ast
        : astAtPath(rootAst, fieldNode.path);

  if (fieldAst !== undefined) inspectAstPrimitives(fieldAst, primitives, new Set());

  return primitives;
};

const hasIssueTag = (nodes: ReadonlyArray<IssueNode>, tag: IssueNode["tag"]): boolean =>
  nodes.some((node) => node.tag === tag);

/** Raw structural schemas. Optional legacy fields are validated and discarded. */
export const DepartmentRowSchema = Schema.Struct({
  id: Schema.Int,
  shortName: Schema.optional(Schema.String),
});

export const TeamRowSchema = Schema.Struct({
  id: Schema.Int,
  departmentId: Schema.NullOr(Schema.Int),
});

export const TeamMembershipRowSchema = Schema.Struct({
  id: Schema.Int,
  userId: Schema.Int,
  teamId: Schema.NullOr(Schema.Int),
  startSemesterId: OptionalNullableInteger,
  endSemesterId: OptionalNullableInteger,
  positionId: OptionalNullableInteger,
  isTeamLeader: OptionalBooleanFlag,
  isLeader: OptionalBooleanFlag,
  isSuspended: OptionalBooleanFlag,
  isActive: OptionalBooleanFlag,
});

export const GlobalContainerRowSchema = Schema.Struct({
  id: Schema.Int,
});

export const GlobalMembershipRowSchema = Schema.Struct({
  id: Schema.Int,
  userId: Schema.Int,
  boardId: Schema.NullOr(Schema.Int),
  startSemesterId: OptionalNullableInteger,
  endSemesterId: OptionalNullableInteger,
  positionId: OptionalNullableInteger,
  isLeader: OptionalBooleanFlag,
  isSuspended: OptionalBooleanFlag,
  isActive: OptionalBooleanFlag,
});

const safeFailureCode = (issue: SchemaIssue.Issue): SchemaFailureCode => {
  const nodes = collectIssueNodes(issue);

  if (hasIssueTag(nodes, "UnexpectedKey")) return "UNEXPECTED_FIELD";

  if (hasIssueTag(nodes, "MissingKey")) return "MISSING_FIELD";

  if (nodes.some((node) => node.path.length === 0 && node.tag === "InvalidType"))
    return "ROW_NOT_OBJECT";

  const hasTypeOrFilterFailure =
    hasIssueTag(nodes, "InvalidType") ||
    hasIssueTag(nodes, "Filter") ||
    hasIssueTag(nodes, "InvalidValue") ||
    hasIssueTag(nodes, "AnyOf");

  const primitives = issuePrimitives(nodes);

  if (hasTypeOrFilterFailure && primitives.hasNull && primitives.hasIntegerNumber)
    return "INVALID_NULLABLE_INTEGER";

  if (hasTypeOrFilterFailure && primitives.hasBoolean) return "INVALID_BOOLEAN";

  if (hasTypeOrFilterFailure && primitives.hasString) return "INVALID_STRING";

  return "INVALID_INTEGER";
};

const safeFailureMessage = (code: SchemaFailureCode): string => `schema rejected row (${code})`;

const decodeWith = <A>(schema: Schema.ConstraintDecoder<A, never>) =>
  flow(
    Schema.decodeUnknownResult(schema, { onExcessProperty: "error" }),
    Result.match({
      onSuccess: (value): DecodeResult<A> => ({ ok: true, value }),
      onFailure: (error): DecodeResult<A> => {
        const code = safeFailureCode(error.issue);

        return { ok: false, failure: { code, message: safeFailureMessage(code) } };
      },
    }),
  );

export const decodeDepartment = flow(
  decodeWith(DepartmentRowSchema),
  (decoded): DecodeResult<DepartmentRow> => {
    return decoded.ok ? { ok: true, value: { id: decoded.value.id } } : decoded;
  },
);

export const decodeTeam = flow(decodeWith(TeamRowSchema), (decoded): DecodeResult<TeamRow> => {
  return decoded.ok
    ? { ok: true, value: { id: decoded.value.id, departmentId: decoded.value.departmentId } }
    : decoded;
});

export const decodeTeamMembership = flow(
  decodeWith(TeamMembershipRowSchema),
  (decoded): DecodeResult<TeamMembershipRow> => {
    return decoded.ok
      ? {
          ok: true,
          value: {
            id: decoded.value.id,
            userId: decoded.value.userId,
            teamId: decoded.value.teamId,
          },
        }
      : decoded;
  },
);

export const decodeGlobalContainer = flow(
  decodeWith(GlobalContainerRowSchema),
  (decoded): DecodeResult<GlobalContainerRow> => {
    return decoded.ok ? { ok: true, value: { id: decoded.value.id } } : decoded;
  },
);

export const decodeGlobalMembership = flow(
  decodeWith(GlobalMembershipRowSchema),
  (decoded): DecodeResult<GlobalMembershipRow> => {
    return decoded.ok
      ? {
          ok: true,
          value: {
            id: decoded.value.id,
            userId: decoded.value.userId,
            boardId: decoded.value.boardId,
          },
        }
      : decoded;
  },
);

export const decodeRows = <A>(
  value: Schema.Json,
  file: string,
  decoder: (value: Schema.Json) => DecodeResult<A>,
): Result.Result<
  { readonly rows: ReadonlyArray<A>; readonly failures: ReadonlyArray<DecodeFailure> },
  SchemaInputError
> => {
  if (!Array.isArray(value)) return Result.fail(new SchemaInputError({ file }));
  const rowsInput = value;

  const rows: A[] = [];
  const failures: DecodeFailure[] = [];

  for (let index = 0; index < rowsInput.length; index += 1) {
    const decoded = decoder(rowsInput[index]);

    if (decoded.ok) {
      rows.push(decoded.value);
    } else {
      failures.push({ file, index, ...decoded.failure });
    }
  }

  return Result.succeed({ rows, failures });
};
