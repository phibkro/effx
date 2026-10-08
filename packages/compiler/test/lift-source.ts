import { Option, Schema } from "effect";
import type { SchemaRef, SymbolRef } from "@effx/ir";
import {
  Terms,
  type EffectModel,
  type EndpointRecord,
  type GeneratedFile,
  type GroupRecord,
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
} from "@effx/compiler";
import { Imports } from "../src/generate/target.ts";
import { defaultGenerationContext } from "../src/Extension.ts";

/*
 * A test-only frontend: it lowers the source the generator printed (the exact grammar of `printTerm`) back
 * into the neutral `Term` model, with the resolution a real frontend does from declarations (imports become
 * `SchemaRef`/`SymbolRef`, native Effect imports become typed claims). It exists so the laws of spec 0019 §2.5
 * run over REAL generator output: generate → print → lower (here) → lift → compile. It parses nothing else.
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
  ["punct", /===|\?\.|\?\?|[{}()[\],:;.?=]/uy],
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
      throw new Error(
        `the test frontend cannot lex ${JSON.stringify(text.slice(index, index + 20))}`,
      );

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
    | { readonly tag: "nullish"; readonly head: Node; readonly tail: ReadonlyArray<Node> }
    | { readonly tag: "equal"; readonly left: Node; readonly right: Node }
    | {
        readonly tag: "cond";
        readonly test: Node;
        readonly consequent: Node;
        readonly alternate: Node;
      }
  );

interface ObjectEntry extends Span {
  readonly key: string;
  readonly value: Node;
}

const jsonString = Schema.fromJsonString(Schema.String);

const decodeKey = (text: string): string =>
  text.startsWith('"') ? Option.getOrThrow(Schema.decodeOption(jsonString)(text)) : text;

/** Recursive descent over the printed grammar: ternary, `??`, `===`, postfix member/call, primaries. */
const parser = (tokens: ReadonlyArray<Token>) => {
  const state = { index: 0 };

  const peek = (): Token | undefined => tokens[state.index];

  const take = (): Token => {
    const token = tokens[state.index];

    if (token === undefined) throw new Error("the test frontend ran out of tokens");

    state.index += 1;

    return token;
  };

  const is = (text: string): boolean => peek()?.text === text && peek()?.kind === "punct";

  const expect = (text: string): Token => {
    const token = take();

    if (token.text !== text)
      throw new Error(`expected ${text} but found ${token.text} at ${token.start}`);

    return token;
  };

  const list = <A>(close: string, item: () => A): ReadonlyArray<A> => {
    const items: Array<A> = [];

    while (!is(close)) {
      items.push(item());

      if (is(",")) take();
    }

    take();

    return items;
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
      case "ident":
        if (token.text === "true" || token.text === "false")
          return {
            tag: "literal",
            json: token.text === "true",
            start: token.start,
            end: token.end,
          };

        if (token.text === "null")
          return { tag: "literal", json: null, start: token.start, end: token.end };

        return { tag: "ident", name: token.text, start: token.start, end: token.end };
      case "punct":
        if (token.text === "(") {
          const inner = expression();
          const close = expect(")");

          return { tag: "paren", inner, start: token.start, end: close.end };
        }

        if (token.text === "[") {
          const items = list("]", expression);

          return {
            tag: "array",
            items,
            start: token.start,
            end: tokens[state.index - 1]?.end ?? token.end,
          };
        }

        if (token.text === "{") {
          const entries = list("}", () => {
            const key = take();

            expect(":");
            const value = expression();

            return { key: decodeKey(key.text), value, start: key.start, end: value.end };
          });

          return {
            tag: "object",
            entries,
            start: token.start,
            end: tokens[state.index - 1]?.end ?? token.end,
          };
        }

        throw new Error(`unexpected ${token.text} at ${token.start}`);
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
          end: tokens[state.index - 1]?.end ?? node.end,
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

  const expression = (): Node => {
    const test = nullish();

    if (!is("?")) return test;

    take();

    const consequent = expression();

    expect(":");

    const alternate = expression();

    return { tag: "cond", test, consequent, alternate, start: test.start, end: alternate.end };
  };

  return { expression, peek, take, expect, is, state };
};

type Statement =
  | {
      readonly tag: "import";
      readonly module: string;
      readonly names: ReadonlyArray<readonly [string, string]>;
      readonly end: number;
    }
  | { readonly tag: "export"; readonly name: string; readonly value: Node };

/** `import { A, B as C } from "m";` and `export const X = <expression>;`: the only statements generated. */
const statements = (text: string): ReadonlyArray<Statement> => {
  const tokens = tokenize(text);
  const parse = parser(tokens);
  const found: Array<Statement> = [];

  while (parse.peek() !== undefined) {
    const head = parse.take();

    if (head.text === "import") {
      parse.expect("{");

      const names: Array<readonly [string, string]> = [];

      while (!parse.is("}")) {
        const imported = parse.take().text;
        const local = parse.peek()?.text === "as" ? (parse.take(), parse.take().text) : imported;

        names.push([imported, local]);

        if (parse.is(",")) parse.take();
      }

      parse.take();
      parse.take();

      const module = Option.getOrThrow(Schema.decodeOption(jsonString)(parse.take().text));
      const end = parse.expect(";").end;

      found.push({ tag: "import", module, names, end });
    } else if (head.text === "export") {
      parse.take();

      const name = parse.take().text;

      parse.expect("=");

      const value = parse.expression();

      parse.expect(";");
      found.push({ tag: "export", name, value });
    } else throw new Error(`the test frontend cannot read the statement starting ${head.text}`);
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

/** What the test frontend knows about the application: which exports are Effect Schemas, and their facts. */
export interface Universe {
  readonly target: TargetProfile;
  readonly schemas: ReadonlyArray<SchemaRef>;
  readonly facts: ReadonlyArray<SchemaFact>;
  readonly markers: ReadonlyArray<MiddlewareFact>;
  readonly root: { readonly symbol: SymbolRef; readonly id: string };
}

const identity = (ref: { readonly module: string; readonly export: string }): string =>
  `${ref.module}\u0000${ref.export}`;

interface Lowering {
  readonly file: string;
  readonly module: string;
  readonly target: TargetProfile;
  readonly resolve: (name: string) => SchemaRef | SymbolRef;
  readonly claims: Map<string, NativeCallee>;
  readonly position: (offset: number) => { offset: number; line: number; col: number };
}

const rangeOf = (lowering: Lowering, span: Span): SourceRange => ({
  file: lowering.file,
  start: lowering.position(span.start),
  end: lowering.position(span.end),
});

const claim = (lowering: Lowering, ref: SchemaRef | SymbolRef, member?: string): void => {
  if (!isNativeKind(ref.export)) return;

  const callee: NativeCallee =
    member === undefined
      ? {
          kind: ref.export,
          target: lowering.target,
          ref: { module: ref.module, export: ref.export },
        }
      : {
          kind: ref.export,
          target: lowering.target,
          ref: { module: ref.module, export: ref.export },
          member,
        };

  lowering.claims.set(`${identity(ref)}\u0000${member ?? ""}`, callee);
};

interface Lowered {
  readonly term: Term;
  readonly spans: ReadonlyArray<TermSpan>;
}

const under = (
  lowering: Lowering,
  prefix: ReadonlyArray<string | number>,
  node: Node,
): ReadonlyArray<TermSpan> =>
  lower(lowering, node).spans.map((span) => ({
    path: [...prefix, ...span.path],
    range: span.range,
  }));

const lower = (lowering: Lowering, node: Node): Lowered => {
  const here = (term: Term, children: ReadonlyArray<TermSpan>): Lowered => ({
    term,
    spans: [{ path: [], range: rangeOf(lowering, node) }, ...children],
  });

  switch (node.tag) {
    case "ident": {
      const reference = lowering.resolve(node.name);

      claim(lowering, reference);

      return here(Terms.ref(reference), []);
    }

    case "literal":
      return here(Terms.lit(node.json), []);
    case "member": {
      const object = lower(lowering, node.object);

      if (object.term._tag === "Ref") claim(lowering, object.term.ref, node.name);

      const term = node.optional
        ? Terms.optionalMember(object.term, node.name)
        : Terms.member(object.term, node.name);

      return here(term, under(lowering, ["term"], node.object));
    }

    case "call": {
      const callee = lower(lowering, node.callee);
      const args = node.args.map((arg) => lower(lowering, arg));

      return here(
        Terms.call(
          callee.term,
          args.map((arg) => arg.term),
        ),
        [
          ...under(lowering, ["callee"], node.callee),
          ...node.args.flatMap((arg, index) => under(lowering, ["args", index], arg)),
        ],
      );
    }

    case "array": {
      const items = node.items.map((item) => lower(lowering, item));
      const literals = items.flatMap((item) => (item.term._tag === "Lit" ? [item.term.json] : []));

      return literals.length === items.length
        ? here(Terms.lit(literals), [])
        : here(
            Terms.arr(items.map((item) => item.term)),
            node.items.flatMap((item, index) => under(lowering, ["items", index], item)),
          );
    }

    case "object": {
      const entries = node.entries.map((entry) => ({
        entry,
        lowered: lower(lowering, entry.value),
      }));

      const literals = entries.flatMap(({ entry, lowered }) =>
        lowered.term._tag === "Lit" ? [[entry.key, lowered.term.json] as const] : [],
      );

      return literals.length === entries.length
        ? here(Terms.lit(Object.fromEntries(literals)), [])
        : here(
            Terms.obj(
              entries.map(({ entry, lowered }) => ({
                key: JSON.stringify(entry.key),
                value: lowered.term,
              })),
              "inline",
            ),
            node.entries.flatMap((entry, index) =>
              under(lowering, ["entries", index, "value"], entry.value),
            ),
          );
    }

    case "paren":
      return here(
        Terms.paren(lower(lowering, node.inner).term),
        under(lowering, ["term"], node.inner),
      );
    case "nullish":
      return here(
        Terms.nullish(
          lower(lowering, node.head).term,
          node.tail.map((tail) => lower(lowering, tail).term),
        ),
        [
          ...under(lowering, ["head"], node.head),
          ...node.tail.flatMap((tail, index) => under(lowering, ["tail", index], tail)),
        ],
      );
    case "equal":
      return here(
        Terms.strictEqual(lower(lowering, node.left).term, lower(lowering, node.right).term),
        [...under(lowering, ["left"], node.left), ...under(lowering, ["right"], node.right)],
      );
    case "cond":
      return here(
        Terms.cond(
          lower(lowering, node.test).term,
          lower(lowering, node.consequent).term,
          lower(lowering, node.alternate).term,
        ),
        [
          ...under(lowering, ["test"], node.test),
          ...under(lowering, ["consequent"], node.consequent),
          ...under(lowering, ["alternate"], node.alternate),
        ],
      );
  }
};

const slot = (lowering: Lowering, node: Node): TermSlot => {
  const lowered = lower(lowering, node);

  return {
    _tag: "Lowered",
    term: lowered.term,
    range: rangeOf(lowering, node),
    spans: lowered.spans,
  };
};

const optionsOf = (lowering: Lowering, node: Node | undefined): OptionsSlot =>
  node === undefined
    ? { _tag: "Absent" }
    : node.tag !== "object"
      ? { _tag: "Entries", entries: [], range: rangeOf(lowering, node) }
      : {
          _tag: "Entries",
          range: rangeOf(lowering, node),
          entries: node.entries.map((entry): OptionEntry => ({
            _tag: "Property",
            name: entry.key,
            value: slot(lowering, entry.value),
            range: rangeOf(lowering, entry),
          })),
        };

interface Chain {
  readonly base: Node & { readonly tag: "call" };
  readonly steps: ReadonlyArray<StepRecord>;
}

/** Splits `X.make(...).a(...).b(...)` into the base call and its postfix method steps. */
const chainOf = (lowering: Lowering, node: Node): Chain => {
  const steps: Array<StepRecord> = [];
  let current = node;

  while (
    current.tag === "call" &&
    current.callee.tag === "member" &&
    !current.callee.optional &&
    current.callee.object.tag === "call"
  ) {
    steps.unshift({
      _tag: "Method",
      name: current.callee.name,
      args: current.args.map((arg) => slot(lowering, arg)),
      range: rangeOf(lowering, { start: current.callee.dot, end: current.end }),
    });
    current = current.callee.object;
  }

  if (current.tag !== "call") throw new Error("the test frontend expects a constructor call");

  return { base: current, steps };
};

const baseOf = (node: Node): string =>
  node.tag === "call" && node.callee.tag === "member" && node.callee.object.tag === "ident"
    ? `${node.callee.object.name}.${node.callee.name}`
    : "";

/** The model of generated contract files: one `SourceFileRecord`, its endpoints and its groups. */
export const modelOf = (files: ReadonlyArray<GeneratedFile>, universe: Universe): EffectModel => {
  const profile = Imports({ ...defaultGenerationContext, target: universe.target });
  const schemas = new Map(universe.schemas.map((ref) => [identity(ref), ref] as const));
  const claims = new Map<string, NativeCallee>();
  const records: Array<SourceFileRecord> = [];
  const endpoints: Array<EndpointRecord> = [];
  const groups: Array<GroupRecord> = [];

  for (const generated of files.filter((file) => file.contents.includes("HttpApiEndpoint."))) {
    const text = generated.contents;
    const module = `generated/${generated.path.replace(/\.ts$/u, "")}`;
    const lineStarts = [0, ...Array.from(text.matchAll(/\n/gu), (match) => match.index + 1)];

    const position = (offset: number) => {
      const line = lineStarts.findLastIndex((start) => start <= offset);

      return { offset, line: line + 1, col: offset - (lineStarts[line] ?? 0) + 1 };
    };

    const parsed = statements(text);
    const locals = new Map<string, SchemaRef | SymbolRef>();

    for (const statement of parsed)
      if (statement.tag === "import")
        for (const [imported, local] of statement.names) {
          const base = { module: statement.module, export: imported };

          locals.set(local, schemas.get(identity(base)) ?? base);
        }

    const declared = parsed.flatMap((statement) =>
      statement.tag === "export" ? [statement.name] : [],
    );

    for (const name of declared) locals.set(name, { module, export: name });

    const lowering: Lowering = {
      file: generated.path,
      module,
      target: universe.target,
      position,
      claims,
      resolve: (name) => {
        const found = locals.get(name);

        if (found === undefined) throw new Error(`the test frontend cannot resolve ${name}`);

        return found;
      },
    };

    const imports = parsed.flatMap((statement) =>
      statement.tag === "import"
        ? statement.names.map(([imported, local]) => ({
            local,
            ref: { module: statement.module, export: imported },
          }))
        : [],
    );

    const importsEnd = Math.max(
      0,
      ...parsed.flatMap((statement) => (statement.tag === "import" ? [statement.end] : [])),
    );

    records.push({
      file: generated.path,
      module,
      idPath: module,
      sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
      exports: declared,
      topLevel: declared,
      imports,
      importsEnd: position(importsEnd),
    });

    for (const statement of parsed) {
      if (statement.tag !== "export") continue;

      const chain = chainOf(lowering, statement.value);
      const base = baseOf(chain.base);

      const statementRange = rangeOf(lowering, {
        start: statement.value.start,
        end: statement.value.end,
      });

      const symbol = { module, export: statement.name };

      if (base.startsWith("HttpApiEndpoint.")) {
        const [key, path, options] = chain.base.args;

        if (key === undefined || path === undefined)
          throw new Error("an endpoint needs a key and a path");

        endpoints.push({
          symbol,
          range: statementRange,
          callee: slot(lowering, chain.base.callee),
          key: slot(lowering, key),
          path: slot(lowering, path),
          options: optionsOf(lowering, options),
          steps: chain.steps,
        });
      } else if (base === "HttpApiGroup.make") {
        const [id, options] = chain.base.args;

        if (id === undefined) throw new Error("a group needs an id");

        groups.push({
          symbol,
          form: "const",
          range: statementRange,
          callee: slot(lowering, chain.base.callee),
          id: slot(lowering, id),
          options: optionsOf(lowering, options),
          steps: chain.steps,
        });
      }
    }
  }

  const httpApi: SymbolRef = { module: profile.httpApi, export: "HttpApi" };

  const rootRange: SourceRange = {
    file: "root.ts",
    start: { offset: 0, line: 1, col: 1 },
    end: { offset: 0, line: 1, col: 1 },
  };

  const make = Terms.member(Terms.ref(httpApi), "make");

  const lowered = (term: Term): TermSlot => ({
    _tag: "Lowered",
    term,
    range: rootRange,
    spans: [],
  });

  for (const [ref, member] of [
    [httpApi, undefined],
    [httpApi, "make"],
  ] as const)
    claim(
      {
        file: "",
        module: "",
        target: universe.target,
        resolve: () => ref,
        claims,
        position: () => ({ offset: 0, line: 1, col: 1 }),
      },
      ref,
      member,
    );

  const root: RootRecord = {
    symbol: universe.root.symbol,
    form: "class",
    range: rootRange,
    callee: lowered(make),
    id: lowered(Terms.lit(universe.root.id)),
    steps: [
      {
        _tag: "Method",
        name: "add",
        args: groups.map((group) => lowered(Terms.ref(group.symbol))),
        range: rootRange,
      },
    ],
  };

  return {
    target: universe.target,
    files: records,
    natives: [...claims.values()],
    schemas: universe.facts,
    markers: universe.markers,
    values: [],
    wrappers: [],
    roots: [root],
    groups,
    endpoints,
    bindings: [],
  };
};
