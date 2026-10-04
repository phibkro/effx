import { Effect, Option } from "effect";
import { defaultGenerationContext, type Generator } from "../Extension.ts";
import { Imports, generated, header, render } from "./emit.ts";
import {
  type HttpGroup,
  type HttpItem,
  endpointKey,
  guardTypeName,
  httpGroups,
  httpItems,
} from "./http-contracts.ts";

/** Anonymous access carries the sole None mechanism; any other mechanism needs a guard. */
export const isProtected = (item: HttpItem): boolean => {
  const credentials = item.access?.acceptedCredentials;

  return credentials !== undefined && !(credentials.length === 1 && credentials[0] === "None");
};

export const groupNeedsGuards = (group: HttpGroup): boolean => group.items.some(isProtected);

const guardEffectType = (imports: Imports, item: HttpItem): string => {
  const handler = Option.getOrThrow(Option.fromUndefinedOr(item.operation.handler));
  const symbol = imports.add(handler.module, handler.export);
  const member = handler.member === undefined ? symbol : `${symbol}.${handler.member}`;

  return `GuardEffect<Parameters<typeof ${member}>[1]>`;
};

const guardGroupLines = (imports: Imports, group: HttpGroup): ReadonlyArray<string> => {
  const request = imports.add("effect/http", "HttpServerRequest");

  return [
    `export type ${guardTypeName(group.root, group.group)} = {`,
    ...group.items.flatMap((item) =>
      isProtected(item)
        ? [
            `  readonly ${JSON.stringify(endpointKey(item))}: (request: ${request}.HttpServerRequest) => ${guardEffectType(imports, item)};`,
          ]
        : [],
    ),
    "};",
  ];
};

/** Only annotated protected operations produce a guards.ts; declarations contain no implementation. */
export const guardsGenerator: Generator = (ir, index, context = defaultGenerationContext) =>
  Effect.map(httpItems(ir, index), (items) => {
    if (context.emit !== "all") return [];
    const localItems = items.filter((item) => item.operation.handler !== undefined);
    const guardedGroups = httpGroups(localItems).filter(groupNeedsGuards);

    if (guardedGroups.length === 0) return [];

    const imports = new Imports(context);
    const effect = imports.add("effect", "Effect");
    const protectedItems = localItems.filter(isProtected);

    const body = [
      `type GuardEffect<Callback> = Callback extends () => ${effect}.Effect<infer Principal, infer Problem, infer Requirements>`,
      `  ? ${effect}.Effect<Principal, Problem, Requirements> : never;`,
      "",
      ...guardedGroups.flatMap((group) => [...guardGroupLines(imports, group), ""]),
      "export type AppGuards = {",
      ...guardedGroups.map(
        (group) =>
          `  readonly ${JSON.stringify(`${group.root}/${group.group}`)}: ${guardTypeName(group.root, group.group)};`,
      ),
      "};",
    ];

    return [generated("guards.ts", render(header(protectedItems), imports, body))];
  });
