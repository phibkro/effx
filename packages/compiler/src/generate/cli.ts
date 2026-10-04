import { Effect, Order, Predicate } from "effect";
import type { SymbolRef } from "@effx/ir";
import { defaultGenerationContext, type Generator } from "../Extension.ts";
import {
  type CliTransport,
  type Exposed,
  Imports,
  exposed,
  generated,
  handlerCall,
  header,
  indent,
  render,
  schemaExpr,
} from "./emit.ts";

const isCli = Predicate.isTagged("cli");

type BoundCli = Exposed<CliTransport> & {
  readonly operation: Exposed<CliTransport>["operation"] & { readonly handler: SymbolRef };
};

const hasHandler = (item: Exposed<CliTransport>): item is BoundCli =>
  item.operation.handler !== undefined;

/** Command words form a trie; a node with a `leaf` is an exposed operation, children are subcommands. */
interface Tree {
  leaf: BoundCli | undefined;
  readonly children: Map<string, Tree>;
}

const emptyTree = (): Tree => ({ leaf: undefined, children: new Map() });

/** Items arrive sorted by exposure id; two exposures with identical words leave the later one. */
const buildTree = (items: ReadonlyArray<BoundCli>): Tree => {
  const root = emptyTree();

  for (const item of items) {
    let node = root;

    for (const word of item.transport.command) {
      const existing = node.children.get(word);

      if (existing === undefined) {
        const next = emptyTree();
        node.children.set(word, next);
        node = next;
      } else {
        node = existing;
      }
    }

    node.leaf = item;
  }

  return root;
};

const byWord = Order.mapInput(Order.String, ([word]: readonly [string, Tree]) => word);

const appendToLast = (lines: ReadonlyArray<string>, suffix: string): ReadonlyArray<string> =>
  lines.map((line, i) => (i === lines.length - 1 ? `${line}${suffix}` : line));

const leafLines = (imports: Imports, name: string, item: BoundCli): ReadonlyArray<string> => {
  const command = imports.add("effect/cli", "Command");
  const flag = imports.add("effect/cli", "Flag");
  const schema = imports.add("effect", "Schema");
  const effect = imports.add("effect", "Effect");
  const console = imports.add("effect", "Console");
  const input = schemaExpr(imports, item.operation.input);
  const success = schemaExpr(imports, item.operation.success);

  return [
    `${command}.make("${name}", {`,
    `  input: ${flag}.String("input").pipe(`,
    `    ${flag}.withDescription("JSON-encoded ${input}"),`,
    `    ${flag}.withSchema(${schema}.fromJsonString(${input})),`,
    "  ),",
    `}, ({ input }) => ${effect}.flatMap(${handlerCall(imports, item.operation.handler, "input")},`,
    `  (result) => ${effect}.flatMap(${schema}.encodeEffect(${schema}.fromJsonString(${success}))(result), ${console}.log)))`,
  ];
};

const commandLines = (imports: Imports, name: string, tree: Tree): ReadonlyArray<string> => {
  const command = imports.add("effect/cli", "Command");

  const head =
    tree.leaf === undefined ? [`${command}.make("${name}")`] : leafLines(imports, name, tree.leaf);

  const children = Array.from(tree.children, ([word, child]) => [word, child] as const).toSorted(
    byWord,
  );

  if (children.length === 0) return head;

  return [
    ...appendToLast(head, ".pipe("),
    `  ${command}.withSubcommands([`,
    ...indent(
      children.flatMap(([word, child]) => appendToLast(commandLines(imports, word, child), ",")),
      2,
    ),
    "  ]),",
    ")",
  ];
};

const body = (imports: Imports, commands: ReadonlyArray<BoundCli>): ReadonlyArray<string> => {
  const command = imports.add("effect/cli", "Command");
  const lines = commandLines(imports, "effx-app", buildTree(commands));

  const root = appendToLast(
    lines.map((line, i) => (i === 0 ? `export const root = ${line}` : line)),
    ";",
  );

  return [
    ...root,
    "",
    "export const run = (version: string) => " + command + ".run(root, { version });",
  ];
};

/** `cli.ts`: a `Command` tree from locally bound CLI exposures, rooted at `effx-app`. */
export const cliGenerator: Generator = (ir, index, context = defaultGenerationContext) =>
  context.emit !== "all"
    ? Effect.succeed([])
    : Effect.map(exposed(ir, index), (all) => {
        const commands = all
          .flatMap((item) =>
            isCli(item.transport) ? [{ ...item, transport: item.transport }] : [],
          )
          .filter(hasHandler);

        if (commands.length === 0) return [];
        const imports = new Imports(context);
        const lines = body(imports, commands);

        return [generated("cli.ts", render(header(commands), imports, lines))];
      });
