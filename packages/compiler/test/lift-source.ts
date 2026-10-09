import { Data, Option, Schema } from "effect";
import { StableId, type SchemaRef, type SymbolRef } from "@effx/ir";
import {
  Terms,
  refIdentity,
  symbolRefOf,
  isNativeModule,
  type EffectModel,
  type EndpointRecord,
  type Finding,
  type FindingKind,
  type GroupRecord,
  type LocalValueCall,
  type LocalValueRecord,
  type LocalDeclarationId,
  type MiddlewareFact,
  type NativeCallee,
  type NativeKind,
  type OptionEntry,
  type OptionsSlot,
  type RootRecord,
  type SchemaFact,
  type SourceFileRecord,
  type SourceRange,
  type StepRecord,
  type TargetProfile,
  type Term,
  type TermSlot,
  type TermSpan,
  type ValueRecord,
  type WrapperFact,
} from "@effx/compiler";
import { defaultGenerationContext } from "../src/Extension.ts";
import { Imports } from "../src/generate/target.ts";

/*
 * A test-only frontend: it lowers TypeScript source text (the grammar of `printTerm` plus the hand-written
 * forms of spec 0019 §3.3: `.pipe((e) => W(e, …))`, spreads, computed keys, local constants) into the
 * neutral `Term` model, the way a real frontend resolves declarations: imports become `SchemaRef` or
 * `SymbolRef` by what the imported module exports, native Effect imports become typed claims, and a
 * construct it cannot lower becomes an `Unlowered` slot with a `Finding`, never a partial term. It exists so
 * the laws of spec 0019 §2.5 and the negative fixtures of §10 run over real text with real offsets.
 */

interface Token {
  readonly kind: "ident" | "string" | "number" | "punct";
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const patterns: ReadonlyArray<readonly [Token["kind"] | "skip", RegExp]> = [
  ["skip", /\s+/uy],
  ["skip", /\/\/[^\n]*/uy],
  ["string", /"(?:[^"\\]|\\.)*"/uy],
  ["number", /-?\d+(?:\.\d+)?/uy],
  ["ident", /[A-Za-z_$][A-Za-z0-9_$]*/uy],
  ["punct", /\.\.\.|===|=>|\?\.|\?\?|[{}()[\],:;.?=<>]/uy],
];

const tokenize = (text: string): ReadonlyArray<Token> => {
  const tokens: Array<Token> = [];
  let index = 0;

  while (index < text.length) {
    const matched = patterns.flatMap(([kind, pattern]) => {
      pattern.lastIndex = index;
      const found = pattern.exec(text);

      return found === null ? [] : [{ kind, text: found[0] }];
    })[0];

    if (matched === undefined)
      throw new Error(`the test frontend cannot lex ${text.slice(index, index + 20)}`);

    if (matched.kind !== "skip")
      tokens.push({
        kind: matched.kind,
        text: matched.text,
        start: index,
        end: index + matched.text.length,
      });

    index += matched.text.length;
  }

  return tokens;
};

interface Span {
  readonly start: number;
  readonly end: number;
}

type Node = Span &
  (
    | { readonly tag: "ident"; readonly name: string }
    | { readonly tag: "literal"; readonly json: Schema.Json }
    | {
        readonly tag: "member";
        readonly object: Node;
        readonly name: string;
        readonly optional: boolean;
        readonly dot: number;
      }
    | { readonly tag: "call"; readonly callee: Node; readonly args: ReadonlyArray<Node> }
    | { readonly tag: "array"; readonly items: ReadonlyArray<Node> }
    | { readonly tag: "object"; readonly entries: ReadonlyArray<ObjectEntry> }
    | { readonly tag: "paren"; readonly inner: Node }
    | { readonly tag: "arrow"; readonly param: string; readonly body: Node }
    | { readonly tag: "nullish"; readonly head: Node; readonly tail: ReadonlyArray<Node> }
    | { readonly tag: "equal"; readonly left: Node; readonly right: Node }
    | {
        readonly tag: "cond";
        readonly test: Node;
        readonly consequent: Node;
        readonly alternate: Node;
      }
  );

type ObjectEntry = Span &
  (
    | {
        readonly kind: "property";
        readonly key: string;
        readonly keyText: string;
        readonly value: Node;
      }
    | { readonly kind: "spread"; readonly value: Node }
    | { readonly kind: "computed"; readonly value: Node }
  );

const jsonString = Schema.fromJsonString(Schema.String);

const decodeKey = (text: string): string =>
  text.startsWith('"') ? Option.getOrThrow(Schema.decodeOption(jsonString)(text)) : text;

/** Recursive descent: ternary, `??`, `===`, postfix member/call, arrows, object/array literals. */
const parser = (tokens: ReadonlyArray<Token>) => {
  const state = { index: 0 };

  const peek = (ahead = 0): Token | undefined => tokens[state.index + ahead];

  const take = (): Token => {
    const token = tokens[state.index];

    if (token === undefined) throw new Error("the test frontend ran out of tokens");

    state.index += 1;

    return token;
  };

  const is = (text: string, ahead = 0): boolean =>
    peek(ahead)?.text === text && peek(ahead)?.kind === "punct";

  const expect = (text: string): Token => {
    const token = take();

    if (token.text !== text)
      throw new Error(`expected ${text} but found ${token.text} at ${token.start}`);

    return token;
  };

  const lastEnd = (fallback: number): number => tokens[state.index - 1]?.end ?? fallback;

  const list = <A>(close: string, item: () => A): ReadonlyArray<A> => {
    const items: Array<A> = [];

    while (!is(close)) {
      items.push(item());

      if (is(",")) take();
    }

    take();

    return items;
  };

  const entry = (): ObjectEntry => {
    const head = peek();

    if (is("...")) {
      const dots = take();
      const value = expression();

      return { kind: "spread", value, start: dots.start, end: value.end };
    }

    if (is("[")) {
      const open = take();
      expression();

      expect("]");
      expect(":");

      const target = expression();

      return { kind: "computed", value: target, start: open.start, end: target.end };
    }

    const key = take();

    expect(":");

    const value = expression();

    return {
      kind: "property",
      key: decodeKey(key.text),
      keyText: key.text,
      value,
      start: head?.start ?? key.start,
      end: value.end,
    };
  };

  const primary = (): Node => {
    const token = take();

    switch (token.kind) {
      case "string":
        return {
          tag: "literal",
          json: Option.getOrThrow(Schema.decodeOption(jsonString)(token.text)),
          start: token.start,
          end: token.end,
        };
      case "number":
        return { tag: "literal", json: Number(token.text), start: token.start, end: token.end };
      case "ident": {
        if (token.text === "true" || token.text === "false")
          return {
            tag: "literal",
            json: token.text === "true",
            start: token.start,
            end: token.end,
          };

        if (token.text === "null")
          return { tag: "literal", json: null, start: token.start, end: token.end };

        if (is("=>")) {
          take();

          const body = expression();

          return { tag: "arrow", param: token.text, body, start: token.start, end: body.end };
        }

        return { tag: "ident", name: token.text, start: token.start, end: token.end };
      }

      case "punct": {
        if (token.text === "(") {
          const lone = peek()?.kind === "ident" && is(")", 1) && is("=>", 2);

          if (lone) {
            const param = take();

            take();
            take();

            const body = expression();

            return { tag: "arrow", param: param.text, body, start: token.start, end: body.end };
          }

          const inner = expression();
          const close = expect(")");

          return { tag: "paren", inner, start: token.start, end: close.end };
        }

        if (token.text === "[") {
          const items = list("]", expression);

          return { tag: "array", items, start: token.start, end: lastEnd(token.end) };
        }

        if (token.text === "{") {
          const entries = list("}", entry);

          return { tag: "object", entries, start: token.start, end: lastEnd(token.end) };
        }

        throw new Error(`unexpected ${token.text} at ${token.start}`);
      }
    }
  };

  const postfix = (): Node => {
    let node = primary();

    while (is(".") || is("?.") || is("(")) {
      const token = take();

      if (token.text === "(") {
        const args = list(")", expression);

        node = {
          tag: "call",
          callee: node,
          args,
          start: node.start,
          end: lastEnd(node.end),
        };
      } else {
        const name = take();

        node = {
          tag: "member",
          object: node,
          name: name.text,
          optional: token.text === "?.",
          dot: token.start,
          start: node.start,
          end: name.end,
        };
      }
    }

    return node;
  };

  const equality = (): Node => {
    const left = postfix();

    if (!is("===")) return left;

    take();

    const right = postfix();

    return { tag: "equal", left, right, start: left.start, end: right.end };
  };

  const nullish = (): Node => {
    const head = equality();
    const tail: Array<Node> = [];

    while (is("??")) {
      take();
      tail.push(equality());
    }

    const last = tail[tail.length - 1];

    return last === undefined
      ? head
      : { tag: "nullish", head, tail, start: head.start, end: last.end };
  };

  /** `as const` is a TypeScript-only wrapper: transparent, like parentheses. */
  const transparent = (node: Node): Node => {
    if (peek()?.text === "as" && peek(1)?.text === "const") {
      take();

      return { ...node, end: take().end };
    }

    return node;
  };

  const expression = (): Node => {
    const test = transparent(nullish());

    if (!is("?")) return test;

    take();

    const consequent = expression();

    expect(":");

    const alternate = expression();

    return { tag: "cond", test, consequent, alternate, start: test.start, end: alternate.end };
  };

  return { expression, peek, take, expect, is };
};

interface Statement extends Span {
  readonly tag: "import" | "const" | "class";
  readonly exported: boolean;
  readonly name: string;
  readonly module: string;
  readonly names: ReadonlyArray<readonly [string, string]>;
  readonly value: Node | undefined;
}

/** `import { A, B as C } from "m";`, `export const X = e;` and `const X = e;`: the only statements read. */
const statements = (text: string): ReadonlyArray<Statement> => {
  const parse = parser(tokenize(text));
  const found: Array<Statement> = [];

  while (parse.peek() !== undefined) {
    const head = parse.take();
    const exported = head.text === "export";
    const word = exported ? parse.take() : head;

    if (word.text === "import") {
      parse.expect("{");

      const names: Array<readonly [string, string]> = [];

      while (!parse.is("}")) {
        const imported = parse.take().text;

        const local =
          parse.peek()?.text === "as"
            ? (() => {
                parse.take();

                return parse.take().text;
              })()
            : imported;

        names.push([imported, local]);

        if (parse.is(",")) parse.take();
      }

      parse.take();
      parse.take();

      const module = Option.getOrThrow(Schema.decodeOption(jsonString)(parse.take().text));

      found.push({
        tag: "import",
        exported: false,
        name: "",
        module,
        names,
        value: undefined,
        start: head.start,
        end: parse.expect(";").end,
      });
    } else if (word.text === "const") {
      const name = parse.take().text;

      parse.expect("=");

      const value = parse.expression();

      found.push({
        tag: "const",
        exported,
        name,
        module: "",
        names: [],
        value,
        start: head.start,
        end: parse.expect(";").end,
      });
    } else if (word.text === "class") {
      const name = parse.take().text;
      parse.expect("{");
      let depth = 1;
      let end = head.end;

      while (depth > 0) {
        const token = parse.take();

        if (token.text === "{") depth += 1;

        if (token.text === "}") depth -= 1;
        end = token.end;
      }

      found.push({
        tag: "class",
        exported,
        name,
        module: "",
        names: [],
        value: undefined,
        start: head.start,
        end,
      });
    } else {
      throw new Error(`the test frontend cannot read the statement starting ${head.text}`);
    }
  }

  return found;
};

const nativeKinds: ReadonlySet<string> = new Set<NativeKind>([
  "HttpApiEndpoint",
  "HttpApiGroup",
  "HttpApi",
  "HttpApiSchema",
  "HttpApiBuilder",
  "OpenApi",
  "Schema",
  "SchemaAST",
]);

const isNativeKind = (name: string): name is NativeKind => nativeKinds.has(name);

/** What the test frontend is told about the application beyond its source. */
export interface Universe {
  readonly target: TargetProfile;
  /** Schema exports of modules that are not part of the source text (bare package modules). */
  readonly schemas: ReadonlyArray<SchemaRef>;
  readonly facts: ReadonlyArray<SchemaFact>;
  readonly markers: ReadonlyArray<MiddlewareFact>;
  /** The root added when the source declares none: every group is `.add`ed to it. */
  readonly root: { readonly symbol: SymbolRef; readonly id: string };
}

export interface SourceFile {
  readonly path: string;
  readonly contents: string;
}

const identity = refIdentity;

const moduleOfPath = (path: string): string => `./${path.replace(/\.tsx?$/u, "")}`;

/** The module key an import specifier names from the module `from`; bare specifiers are their own key. */
const resolveSpecifier = (from: string, specifier: string): string => {
  if (!specifier.startsWith(".")) return specifier;

  const names = from.replace(/^\.\//u, "").split("/").slice(0, -1);
  let ups = 0;

  for (const part of specifier.replace(/\.(?:js|ts|tsx|mjs)$/u, "").split("/")) {
    if (part === "." || part === "") continue;

    if (part !== "..") names.push(part);
    else if (names.length > 0) names.pop();
    else ups += 1;
  }

  return `${ups > 0 ? "../".repeat(ups) : "./"}${names.join("/")}`;
};

/** A node the frontend cannot lower: thrown while lowering, turned into a `Finding` at the slot boundary. */
class Unlowerable extends Data.TaggedError("Unlowerable")<{
  readonly kind: FindingKind;
  readonly construct: string;
  readonly span: Span;
  readonly enclosing: SymbolRef | undefined;
}> {}

const unlowerable = (
  kind: FindingKind,
  construct: string,
  span: Span,
  enclosing?: SymbolRef,
): Unlowerable => new Unlowerable({ kind, construct, span, enclosing });

interface Scope {
  readonly file: string;
  readonly module: string;
  readonly target: TargetProfile;
  readonly resolve: (name: string, at: Span) => SchemaRef | SymbolRef;
  readonly claims: Map<string, NativeCallee>;
  readonly schemas: ReadonlyMap<string, SchemaRef>;
  readonly staticHolders: ReadonlySet<string>;
  readonly localIds: ReadonlyMap<string, LocalDeclarationId>;
  readonly localCalls: Array<LocalValueCall>;
  readonly position: (offset: number) => { offset: number; line: number; col: number };
}

const rangeOf = (scope: Scope, span: Span): SourceRange => ({
  file: scope.file,
  start: scope.position(span.start),
  end: scope.position(span.end),
});

const claim = (
  scope: Pick<Scope, "target" | "claims">,
  ref: SchemaRef | SymbolRef,
  member?: string,
): void => {
  const direct = Array.from(nativeKinds)
    .filter(isNativeKind)
    .find(
      (kind) => ref.module.endsWith(`/${kind}`) && isNativeModule(scope.target, kind, ref.module),
    );

  const kind = isNativeKind(ref.export) ? ref.export : direct;

  if (kind === undefined) return;

  const base = {
    kind,
    target: scope.target,
    ref: { module: ref.module, export: ref.export },
  };

  scope.claims.set(
    `${identity(ref)}\u0000${member ?? ""}`,
    member === undefined ? base : { ...base, member },
  );
};

interface Lowered {
  readonly term: Term;
  readonly spans: ReadonlyArray<TermSpan>;
}

const under = (
  scope: Scope,
  prefix: ReadonlyArray<string | number>,
  node: Node,
): ReadonlyArray<TermSpan> =>
  lower(scope, node).spans.map((span) => ({
    path: [...prefix, ...span.path],
    range: span.range,
  }));

const symbolOf = symbolRefOf;

/** Source positions inside a collapsed Lit(Json), without changing the neutral term algebra. */
const jsonSpans = (
  scope: Scope,
  node: Node,
  path: ReadonlyArray<string | number>,
): ReadonlyArray<TermSpan> => [
  { path, range: rangeOf(scope, node) },
  ...(node.tag === "object"
    ? node.entries.flatMap((entry) =>
        entry.kind === "property" ? jsonSpans(scope, entry.value, [...path, entry.key]) : [],
      )
    : node.tag === "array"
      ? node.items.flatMap((item, index) => jsonSpans(scope, item, [...path, index]))
      : []),
];

const lower = (scope: Scope, node: Node): Lowered => {
  const here = (term: Term, children: ReadonlyArray<TermSpan>): Lowered => ({
    term,
    spans: [{ path: [], range: rangeOf(scope, node) }, ...children],
  });

  switch (node.tag) {
    case "ident": {
      const reference = scope.resolve(node.name, node);

      claim(scope, reference);

      return here(Terms.ref(reference), []);
    }

    case "literal":
      return here(Terms.lit(node.json), []);
    case "member": {
      const object = lower(scope, node.object);

      if (object.term._tag === "Ref" && !node.optional) {
        const symbol = symbolOf(object.term.ref);
        const member = symbol.member === undefined ? node.name : `${symbol.member}.${node.name}`;
        const schema = scope.schemas.get(identity({ ...symbol, member }));

        if (schema !== undefined) return here(Terms.ref(schema), []);

        if (
          !("symbolId" in object.term.ref) &&
          scope.staticHolders.has(identity({ module: symbol.module, export: symbol.export }))
        )
          return here(Terms.ref({ ...symbol, member }), []);
      }

      if (object.term._tag === "Ref") claim(scope, object.term.ref, node.name);

      const term = node.optional
        ? Terms.optionalMember(object.term, node.name)
        : Terms.member(object.term, node.name);

      return here(term, under(scope, ["term"], node.object));
    }

    case "call": {
      const callee = lower(scope, node.callee);

      const callerRef =
        callee.term._tag === "Ref"
          ? symbolOf(callee.term.ref)
          : callee.term._tag === "Member" && callee.term.term._tag === "Ref"
            ? { ...symbolOf(callee.term.term.ref), member: callee.term.member }
            : undefined;

      const args = node.args.map((arg) => {
        try {
          return lower(scope, arg);
        } catch (error) {
          if (
            error instanceof Unlowerable &&
            error.enclosing === undefined &&
            callerRef !== undefined
          )
            throw unlowerable(error.kind, error.construct, error.span, callerRef);

          throw error;
        }
      });

      return here(
        Terms.call(
          callee.term,
          args.map((arg) => arg.term),
        ),
        [
          ...under(scope, ["callee"], node.callee),
          ...node.args.flatMap((arg, index) => under(scope, ["args", index], arg)),
        ],
      );
    }

    case "array": {
      const items = node.items.map((item) => lower(scope, item));
      const literals = items.flatMap((item) => (item.term._tag === "Lit" ? [item.term.json] : []));

      return literals.length === items.length
        ? here(Terms.lit(literals), jsonSpans(scope, node, ["json"]))
        : here(
            Terms.arr(items.map((item) => item.term)),
            node.items.flatMap((item, index) => under(scope, ["items", index], item)),
          );
    }

    case "object": {
      const entries = node.entries.map((entry) => {
        if (entry.kind === "spread") throw unlowerable("spread", "object spread", entry, undefined);

        if (entry.kind === "computed")
          throw unlowerable("computed-key", "computed property key", entry, undefined);

        return { entry, lowered: lower(scope, entry.value) };
      });

      const literals = entries.flatMap(({ entry, lowered }) =>
        lowered.term._tag === "Lit" ? [[entry.key, lowered.term.json] as const] : [],
      );

      return literals.length === entries.length
        ? here(Terms.lit(Object.fromEntries(literals)), jsonSpans(scope, node, ["json"]))
        : here(
            Terms.obj(
              entries.map(({ entry, lowered }) => ({
                key: entry.keyText,
                value: lowered.term,
              })),
              "inline",
            ),
            node.entries.flatMap((entry, index) =>
              entry.kind === "property"
                ? under(scope, ["entries", index, "value"], entry.value)
                : [],
            ),
          );
    }

    case "paren":
      return here(Terms.paren(lower(scope, node.inner).term), under(scope, ["term"], node.inner));
    case "arrow":
      throw unlowerable("closure", "arrow function", node, undefined);
    case "nullish":
      return here(
        Terms.nullish(
          lower(scope, node.head).term,
          node.tail.map((tail) => lower(scope, tail).term),
        ),
        [
          ...under(scope, ["head"], node.head),
          ...node.tail.flatMap((tail, index) => under(scope, ["tail", index], tail)),
        ],
      );
    case "equal":
      return here(Terms.strictEqual(lower(scope, node.left).term, lower(scope, node.right).term), [
        ...under(scope, ["left"], node.left),
        ...under(scope, ["right"], node.right),
      ]);
    case "cond":
      return here(
        Terms.cond(
          lower(scope, node.test).term,
          lower(scope, node.consequent).term,
          lower(scope, node.alternate).term,
        ),
        [
          ...under(scope, ["test"], node.test),
          ...under(scope, ["consequent"], node.consequent),
          ...under(scope, ["alternate"], node.alternate),
        ],
      );
  }
};

const findingOf = (scope: Scope, error: Unlowerable): Finding => {
  const finding = {
    kind: error.kind,
    construct: error.construct,
    range: rangeOf(scope, error.span),
  } satisfies Finding;

  return error.enclosing === undefined
    ? finding
    : { ...finding, enclosingCall: { callee: error.enclosing } };
};

/** One expression position: lowered completely, or unlowered with the finding that prevented it. */
const slot = (scope: Scope, node: Node): TermSlot => {
  try {
    const lowered = lower(scope, node);

    return {
      _tag: "Lowered",
      term: lowered.term,
      range: rangeOf(scope, node),
      spans: lowered.spans,
    };
  } catch (error) {
    if (!(error instanceof Unlowerable)) throw error;

    const [argument] = node.tag === "call" ? node.args : [];
    const local = argument?.tag === "ident" ? scope.localIds.get(argument.name) : undefined;

    if (
      node.tag === "call" &&
      node.args.length === 1 &&
      local !== undefined &&
      error.kind === "local-reference" &&
      error.construct === local.name &&
      error.enclosing !== undefined
    )
      scope.localCalls.push({
        range: rangeOf(scope, node),
        callee: error.enclosing,
        argument: local,
      });

    return { _tag: "Unlowered", range: rangeOf(scope, node), findings: [findingOf(scope, error)] };
  }
};

const optionsOf = (scope: Scope, node: Node | undefined): OptionsSlot => {
  if (node === undefined) return { _tag: "Absent" };

  if (node.tag !== "object")
    return {
      _tag: "Unlowered",
      range: rangeOf(scope, node),
      findings: [
        {
          kind: "non-literal",
          construct: "an options argument that is not an object literal",
          range: rangeOf(scope, node),
        },
      ],
    };

  return {
    _tag: "Entries",
    range: rangeOf(scope, node),
    entries: node.entries.map((entry): OptionEntry => {
      if (entry.kind === "property")
        return {
          _tag: "Property",
          name: entry.key,
          value: slot(scope, entry.value),
          range: rangeOf(scope, entry),
        };

      return {
        _tag: "Unsupported",
        finding: {
          kind: entry.kind === "spread" ? "spread" : "computed-key",
          construct: entry.kind === "spread" ? "options spread" : "computed options key",
          range: rangeOf(scope, entry),
        },
      };
    }),
  };
};

interface Chain {
  readonly base: Node & { readonly tag: "call" };
  readonly steps: ReadonlyArray<StepRecord>;
}

/** Does the node mention the identifier `name` anywhere (so a closure over its parameter is not `W(e, …)`)? */
const mentions = (node: Node, name: string): boolean => {
  switch (node.tag) {
    case "ident":
      return node.name === name;
    case "literal":
      return false;
    case "member":
      return mentions(node.object, name);
    case "call":
      return mentions(node.callee, name) || node.args.some((arg) => mentions(arg, name));
    case "array":
      return node.items.some((item) => mentions(item, name));
    case "object":
      return node.entries.some((entry) => mentions(entry.value, name));
    case "paren":
      return mentions(node.inner, name);
    case "arrow":
      return node.param !== name && mentions(node.body, name);
    case "nullish":
      return mentions(node.head, name) || node.tail.some((tail) => mentions(tail, name));
    case "equal":
      return mentions(node.left, name) || mentions(node.right, name);
    case "cond":
      return (
        mentions(node.test, name) ||
        mentions(node.consequent, name) ||
        mentions(node.alternate, name)
      );
  }
};

/** `W(e, a, b)` where `e` is the arrow parameter, used exactly once and first: the application step. */
const applyOf = (
  scope: Scope,
  arrow: Node & { readonly tag: "arrow" },
  range: SourceRange,
): StepRecord => {
  const body = arrow.body;

  if (
    body.tag === "call" &&
    body.args[0]?.tag === "ident" &&
    body.args[0].name === arrow.param &&
    !mentions(body.callee, arrow.param) &&
    !body.args.slice(1).some((arg) => mentions(arg, arrow.param))
  )
    return {
      _tag: "Apply",
      form: "pipe",
      callee: slot(scope, body.callee),
      args: body.args.slice(1).map((arg) => slot(scope, arg)),
      range,
    };

  return {
    _tag: "Unsupported",
    finding: { kind: "closure", construct: "a closure that is not W(e, …)", range },
  };
};

/** Splits `X.make(...).a(...).b(...)` into the base call and its postfix method steps. */
const chainOf = (scope: Scope, node: Node): Chain => {
  const steps: Array<StepRecord> = [];
  let current = node;

  while (
    current.tag === "call" &&
    current.callee.tag === "member" &&
    !current.callee.optional &&
    current.callee.object.tag === "call"
  ) {
    const range = rangeOf(scope, { start: current.callee.dot, end: current.end });
    const [only] = current.args;

    steps.unshift(
      current.callee.name === "pipe" && current.args.length === 1 && only?.tag === "arrow"
        ? applyOf(scope, only, range)
        : {
            _tag: "Method",
            name: current.callee.name,
            args: current.args.map((arg) => slot(scope, arg)),
            range,
          },
    );

    current = current.callee.object;
  }

  if (current.tag !== "call") throw new Error("the test frontend expects a constructor call");

  return { base: current, steps };
};

const baseOf = (scope: Scope, node: Node): string => {
  if (node.tag !== "call" || node.callee.tag !== "member" || node.callee.object.tag !== "ident")
    return "";

  const reference = scope.resolve(node.callee.object.name, node.callee.object);

  return isNativeKind(reference.export) ? `${reference.export}.${node.callee.name}` : "";
};

const keysOf = (node: Node | undefined): ReadonlyArray<string> | undefined =>
  node?.tag === "object"
    ? node.entries.flatMap((entry) => (entry.kind === "property" ? [entry.key] : []))
    : undefined;

/** The model of source files: records for every file, endpoint, group, root and exported value. */
export const modelOf = (files: ReadonlyArray<SourceFile>, universe: Universe): EffectModel => {
  const profile = Imports({ ...defaultGenerationContext, target: universe.target });
  const claims = new Map<string, NativeCallee>();
  const claimScope = { target: universe.target, claims };

  const parsed = files.map((file) => ({
    file,
    module: moduleOfPath(file.path),
    statements: statements(file.contents),
  }));

  const staticHolders = new Set(
    parsed.flatMap((unit) =>
      unit.statements.flatMap((statement) =>
        statement.tag === "class" && statement.exported
          ? [identity({ module: unit.module, export: statement.name })]
          : [],
      ),
    ),
  );

  // An export is a Schema when its initializer calls a member of the native `Schema` namespace.
  const schemaRefs = new Map<string, SchemaRef>(
    universe.schemas.map((ref) => [identity(ref), ref] as const),
  );

  const facts = new Map<string, SchemaFact>(
    universe.facts.map((fact) => [identity(fact.ref), fact]),
  );

  for (const unit of parsed) {
    const imported = new Map(
      unit.statements.flatMap((statement) =>
        statement.tag === "import"
          ? statement.names.map(
              ([name, local]) => [local, { module: statement.module, export: name }] as const,
            )
          : [],
      ),
    );

    for (const statement of unit.statements) {
      const value = statement.value;

      if (!statement.exported || value === undefined || value.tag !== "call") continue;

      const head = value.callee.tag === "member" ? value.callee.object : undefined;
      const namespace = head?.tag === "ident" ? imported.get(head.name) : undefined;

      if (namespace?.export !== "Schema") continue;

      const ref: SchemaRef = {
        module: unit.module,
        export: statement.name,
        symbolId: StableId.make("schema", `${unit.module.replace(/^\.\//u, "")}/${statement.name}`),
      };

      schemaRefs.set(identity(ref), ref);

      const fields =
        value.callee.tag === "member" && value.callee.name === "Struct" ? value.args[0] : undefined;

      const all = keysOf(fields);

      if (all !== undefined && fields?.tag === "object")
        facts.set(identity(ref), {
          ref,
          allKeys: all,
          requiredKeys: fields.entries.flatMap((entry) =>
            entry.kind === "property" &&
            !(
              entry.value.tag === "call" &&
              entry.value.callee.tag === "member" &&
              entry.value.callee.name.startsWith("optional")
            )
              ? [entry.key]
              : [],
          ),
        });
    }
  }

  const refOf = (module: string, name: string): SchemaRef | SymbolRef =>
    schemaRefs.get(identity({ module, export: name })) ?? { module, export: name };

  const records: Array<SourceFileRecord> = [];
  const endpoints: Array<EndpointRecord> = [];
  const groups: Array<GroupRecord> = [];
  const roots: Array<RootRecord> = [];
  const values: Array<ValueRecord> = [];
  const localValues: Array<LocalValueRecord> = [];
  const localCalls: Array<LocalValueCall> = [];
  const wrappers: Array<WrapperFact> = [];

  for (const unit of parsed) {
    const text = unit.file.contents;
    const lineStarts = [0, ...Array.from(text.matchAll(/\n/gu), (match) => match.index + 1)];

    const position = (offset: number) => {
      const line = lineStarts.findLastIndex((start) => start <= offset);

      return { offset, line: line + 1, col: offset - (lineStarts[line] ?? 0) + 1 };
    };

    const locals = new Map<string, SchemaRef | SymbolRef>();
    const nonExported = new Set<string>();

    for (const statement of unit.statements) {
      if (statement.tag === "import")
        for (const [imported, local] of statement.names)
          locals.set(local, refOf(resolveSpecifier(unit.module, statement.module), imported));
      else if (statement.exported) locals.set(statement.name, refOf(unit.module, statement.name));
      else nonExported.add(statement.name);
    }

    const localIds = new Map(
      unit.statements.flatMap((statement) =>
        statement.tag === "const" && !statement.exported && statement.value !== undefined
          ? ([
              [
                statement.name,
                { file: unit.file.path, offset: statement.start, name: statement.name },
              ],
            ] as const)
          : [],
      ),
    );

    const scope: Scope = {
      file: unit.file.path,
      module: unit.module,
      target: universe.target,
      localIds,
      localCalls,
      position,
      claims,
      schemas: schemaRefs,
      staticHolders,
      resolve: (name, at) => {
        const found = locals.get(name);

        if (found !== undefined) return found;

        throw unlowerable(
          nonExported.has(name) ? "local-reference" : "unresolved",
          name,
          at,
          undefined,
        );
      },
    };

    const declared = unit.statements.flatMap((statement) =>
      statement.tag === "const" && statement.exported ? [statement.name] : [],
    );

    const importStatements = unit.statements.filter((statement) => statement.tag === "import");

    records.push({
      file: unit.file.path,
      module: unit.module,
      idPath: unit.module.replace(/^\.\//u, ""),
      sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
      exports: declared,
      topLevel: [
        ...declared,
        ...unit.statements.flatMap((statement) =>
          statement.tag === "const" && !statement.exported ? [statement.name] : [],
        ),
      ],
      imports: importStatements.flatMap((statement) =>
        statement.names.map(([imported, local]) => ({
          local,
          ref: { module: resolveSpecifier(unit.module, statement.module), export: imported },
        })),
      ),
      importsEnd: position(Math.max(0, ...importStatements.map((statement) => statement.end))),
    });

    for (const statement of unit.statements) {
      const node = statement.value;

      if (statement.tag !== "const" || node === undefined) continue;

      if (!statement.exported) {
        const id = localIds.get(statement.name);

        if (id !== undefined)
          localValues.push({
            kind: "const",
            id,
            range: rangeOf(scope, statement),
            init: slot(scope, node),
          });

        continue;
      }

      const symbol = { module: unit.module, export: statement.name };
      const range = rangeOf(scope, statement);

      if (schemaRefs.has(identity(symbol))) {
        values.push({ symbol, range, init: slot(scope, node) });

        continue;
      }

      if (node.tag === "arrow") {
        const body = node.body;

        const headersNode =
          body.tag === "call" &&
          body.callee.tag === "member" &&
          body.callee.name === "WithHeaders" &&
          body.callee.object.tag === "ident" &&
          locals.get(body.callee.object.name)?.export === "HttpApiSchema" &&
          body.args[0]?.tag === "ident" &&
          body.args[0].name === node.param
            ? body.args[1]
            : undefined;

        if (headersNode !== undefined) {
          const expression = slot(scope, headersNode);
          const named = expression._tag === "Lowered" ? expression.term : undefined;

          wrappers.push({
            helper: symbol,
            range,
            headers:
              named?._tag === "Ref" && "symbolId" in named.ref
                ? { _tag: "Named", ref: named.ref }
                : { _tag: "Inline", expression },
          });
        }
      }

      if (node.tag !== "call") {
        values.push({ symbol, range, init: slot(scope, node) });
        continue;
      }

      const chain = chainOf(scope, node);
      const base = baseOf(scope, chain.base);

      if (base.startsWith("HttpApiEndpoint.")) {
        const [key, path, options] = chain.base.args;

        if (key === undefined || path === undefined)
          throw new Error("an endpoint needs a key and a path");

        endpoints.push({
          symbol,
          range,
          callee: slot(scope, chain.base.callee),
          key: slot(scope, key),
          path: slot(scope, path),
          options: optionsOf(scope, options),
          steps: chain.steps,
        });
      } else if (base === "HttpApiGroup.make") {
        const [id, options] = chain.base.args;

        if (id === undefined) throw new Error("a group needs an id");

        groups.push({
          symbol,
          form: "const",
          range,
          callee: slot(scope, chain.base.callee),
          id: slot(scope, id),
          options: optionsOf(scope, options),
          steps: chain.steps,
        });
      } else if (base === "HttpApi.make") {
        const [id] = chain.base.args;

        if (id === undefined) throw new Error("a root needs an id");

        roots.push({
          symbol,
          form: "const",
          range,
          callee: slot(scope, chain.base.callee),
          id: slot(scope, id),
          steps: chain.steps,
        });
      } else values.push({ symbol, range, init: slot(scope, node) });
    }
  }

  const httpApi: SymbolRef = { module: profile.httpApi, export: "HttpApi" };

  const synthetic: SourceRange = {
    file: "root.ts",
    start: { offset: 0, line: 1, col: 1 },
    end: { offset: 0, line: 1, col: 1 },
  };

  claim(claimScope, httpApi);
  claim(claimScope, httpApi, "make");

  const lowered = (term: Term): TermSlot => ({
    _tag: "Lowered",
    term,
    range: synthetic,
    spans: [],
  });

  // Source without a root of its own is mounted on the universe's root, which adds every group.
  const allRoots: ReadonlyArray<RootRecord> =
    roots.length > 0
      ? roots
      : [
          {
            symbol: universe.root.symbol,
            form: "class",
            range: synthetic,
            callee: lowered(Terms.member(Terms.ref(httpApi), "make")),
            id: lowered(Terms.lit(universe.root.id)),
            steps: [
              {
                _tag: "Method",
                name: "add",
                args: groups.map((group) => lowered(Terms.ref(group.symbol))),
                range: synthetic,
              },
            ],
          },
        ];

  return {
    target: universe.target,
    files: records,
    natives: [...claims.values()],
    schemas: [...facts.values()],
    markers: universe.markers,
    values,
    localValues,
    localCalls,
    wrappers,
    roots: allRoots,
    groups,
    endpoints,
    bindings: [],
    /** The collected lift sources record no definition facts of their own. */
    definitions: [],
  };
};
