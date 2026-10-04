import { Predicate, Schema } from "effect";
import type { ApplicationIR } from "@effx/ir";
import type { GenerationContext } from "../Extension.ts";
import { defaultGenerationContext } from "../Extension.ts";

/** All generated Effect package imports are selected from this one profile table. */
const modules = {
  "effect-4.0": {
    core: "effect",
    http: "effect/http",
    httpApi: "effect/http-api",
    net: "effect/net",
    rpc: "effect/rpc",
    cli: "effect/cli",
    sql: "effect/sql",
  },
  "effect-4.0-rc": {
    core: "effect",
    http: "effect/unstable/http",
    httpApi: "effect/unstable/httpapi",
    net: "effect/unstable/net",
    rpc: "effect/unstable/rpc",
    cli: "effect/unstable/cli",
    sql: "effect/unstable/sql",
  },
} as const;

// SAFETY: Object.keys returns only keys of this closed literal profile table.

const moduleKeys = Object.keys(modules["effect-4.0"]) as Array<
  keyof (typeof modules)["effect-4.0"]
>;

/** Versioned families map through one table; other installed Effect exports keep their path. */
const targetModule = (context: GenerationContext, module: string): string | undefined => {
  const names = modules[context.target];
  const stable = modules["effect-4.0"];
  let inFamily = false;

  for (const name of moduleKeys) {
    if (name === "core") continue;
    const source = stable[name];
    const destination = names[name];

    if (module === source || module === destination) {
      return context.resolveEffectModule === undefined || context.resolveEffectModule(destination)
        ? destination
        : undefined;
    }

    if (module.startsWith(source + "/")) {
      inFamily = true;
      const mapped = destination + module.slice(source.length);

      if (context.resolveEffectModule?.(mapped) === true) return mapped;
    }

    if (destination !== source && module.startsWith(destination + "/")) {
      inFamily = true;

      if (context.resolveEffectModule?.(module) === true) return module;
    }
  }

  return !inFamily && context.resolveEffectModule?.(module) === true ? module : undefined;
};

export const Imports = (context: GenerationContext = defaultGenerationContext) =>
  modules[context.target];

/** The pipeline checks source modules before rendering; imports remain a total pure projection. */
export const isTargetModuleSupported = (context: GenerationContext, module: string): boolean =>
  !module.startsWith("effect/") || targetModule(context, module) !== undefined;

/** Collect unsupported app symbol modules, including those inside JSON extension payloads. */
export const unsupportedModules = (
  ir: ApplicationIR,
  context: GenerationContext,
): ReadonlyArray<string> => {
  const unsupported = new Set<string>();

  const checkModule = (module: string): void => {
    if (!isTargetModuleSupported(context, module)) unsupported.add(module);
  };

  const visitJson = (value: Schema.Json): void => {
    if (Array.isArray(value)) {
      for (const item of value) visitJson(item);

      return;
    }

    if (!Predicate.isObject(value)) return;

    if (Predicate.isString(value.module) && Predicate.isString(value.export))
      checkModule(value.module);

    // SAFETY: Extension.data is Schema.Json in the decoded IR; narrowing it to an
    // object does not change the JSON type of its own property values.
    const record = value as Readonly<Record<string, Schema.Json>>;

    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      const child = record[key];

      if (child !== undefined) visitJson(child);
    }
  };

  for (const node of ir.nodes) {
    switch (node._tag) {
      case "Schema":
        checkModule(node.ref.module);
        break;
      case "Model":
        checkModule(node.schema.module);

        for (const view of node.views) checkModule(view.schema.module);
        break;
      case "Service":
        checkModule(node.symbol.module);
        break;
      case "Operation":
        checkModule(node.input.module);
        checkModule(node.success.module);

        for (const failure of node.errors.values) checkModule(failure.module);

        if (node.handler !== undefined) checkModule(node.handler.module);
        break;
      case "HttpGroup":
        if (node.rootSymbol !== undefined) checkModule(node.rootSymbol.module);
        break;
      case "Extension":
        visitJson(node.data);
        break;
      default:
        break;
    }
  }

  return Array.from(unsupported).toSorted();
};

/** Resolve already-absolute POSIX paths, independent of the host's current directory. */
const segments = (value: string): Array<string> => {
  const parts: Array<string> = [];

  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") parts.pop();
    else parts.push(part);
  }

  return parts;
};

/** Frontend local refs are relative to the canonical base, not to the chosen output directory. */
const rebase = (module: string, canonicalBase: string, outputDir: string): string => {
  const source = segments(`${canonicalBase}/${module}`);
  const output = segments(outputDir);
  let common = 0;

  while (common < source.length && source[common] === output[common]) common++;

  const relative = [...output.slice(common).map(() => ".."), ...source.slice(common)].join("/");

  return relative.startsWith(".") ? relative : `./${relative}`;
};

/**
 * Map a generated import to the target installation. Explicit `.ts` paths point to generated
 * siblings; extensionless local refs originated at the canonical source import base and must
 * be rebased before choosing the target TypeScript extension policy.
 */
export const moduleSpecifier = (context: GenerationContext, module: string): string => {
  if (module === "effect") return module;

  if (module.startsWith("effect/")) {
    return targetModule(context, module) ?? module; // Unsupported refs are diagnosed before generation.
  }

  if (!module.startsWith("./") && !module.startsWith("../")) return module;

  const sourceRef = !/\.[cm]?[jt]sx?$/.test(module) && !module.endsWith(".js");

  const local =
    sourceRef &&
    context.canonicalImportBase !== undefined &&
    context.outputDir !== undefined &&
    context.canonicalImportBase !== context.outputDir
      ? rebase(module, context.canonicalImportBase, context.outputDir)
      : module;

  const suffix = context.allowImportingTsExtensions ? ".ts" : ".js";

  return /\.[cm]?tsx?$/.test(local)
    ? local.replace(/\.[cm]?tsx?$/, suffix)
    : sourceRef
      ? local + suffix
      : local;
};
