import { Option, Predicate, Schema } from "effect";
import { Builtins } from "@effx/runtime";
import { StableId, type HttpGroupNode } from "@effx/ir";
import { Contribution, type Analysis, type Extension } from "../Extension.ts";
import type { Diagnostic } from "../Diagnostic.ts";
import { HttpDiagnostics } from "../diagnostics/http.ts";
import { extension, implement } from "../annotation.ts";
import { expandGroupDefaults } from "../group-defaults.ts";
import { groupApiName, groupClassName, handlerName } from "../generate/http-contracts.ts";
import { HttpContractData } from "./http-contract.ts";

const safeName = /^[A-Za-z_$][A-Za-z0-9_$-]*$/u;

const safeGroupName = /^[A-Za-z_$][A-Za-z0-9_$._-]*$/u;

type HttpGroupDraft = { -readonly [K in keyof HttpGroupNode]: HttpGroupNode[K] };

/** Group declarations have their own IR identity, independent of an operation binding. */
const group = implement(Builtins.HttpGroup, {
  before: (_annotation, declaration) =>
    declaration.kind !== "class" && declaration.kind !== "builder"
      ? HttpDiagnostics.EFFX2402.emit({ _tag: "GroupTarget", subject: declaration.id })
      : undefined,
  read: ([options], { declaration }) => {
    const root = Predicate.isString(options.root) ? options.root : options.root.identifier;

    if (!safeName.test(root) || !safeGroupName.test(options.group))
      return Contribution.diagnostics(
        HttpDiagnostics.EFFX2402.emit({ _tag: "GroupIdentifiers", subject: declaration.id }),
      );

    const data: HttpGroupDraft = {
      _tag: "HttpGroup",
      id: StableId.make("group", `${root}/${options.group}`),
      root,
      group: options.group,
    };

    if (!Predicate.isString(options.root)) data.rootSymbol = options.root.ref;

    if (options.title !== undefined) data.title = options.title;

    if (options.description !== undefined) data.description = options.description;

    if (options.displayName !== undefined) data.displayName = options.displayName;

    return Contribution.make([data]);
  },
});

const validate: Analysis = (ir) => {
  const definitions = new Map<string, string>();
  const diagnostics: Array<Diagnostic> = [];

  for (const node of ir.nodes) {
    if (node._tag !== "HttpGroup") continue;

    if (
      !safeName.test(node.root) ||
      !safeGroupName.test(node.group) ||
      node.id !== StableId.make("group", `${node.root}/${node.group}`)
    ) {
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "GroupIdentity", subject: node.id }));
      continue;
    }

    const key = `${node.root}\u0000${node.group}`;

    const metadata = JSON.stringify([
      node.title,
      node.description,
      node.displayName,
      node.rootSymbol,
    ]);

    const previous = definitions.get(key);

    if (previous !== undefined && previous !== metadata)
      diagnostics.push(HttpDiagnostics.EFFX2402.emit({ _tag: "GroupConflict", subject: node.id }));
    else definitions.set(key, metadata);
  }

  return diagnostics;
};

/** Check declarations as well as inferred contract groups, including groups without operations. */
const validateExportNames: Analysis = (ir) => {
  const identities = new Map<string, { readonly root: string; readonly group: string }>();

  for (const node of ir.nodes) {
    if (node._tag === "HttpGroup") {
      identities.set(`${node.root}\0${node.group}`, { root: node.root, group: node.group });
    } else if (
      node._tag === "Extension" &&
      node.extension === "http-contract" &&
      node.tag === "HttpContract"
    ) {
      const contract = Option.getOrUndefined(
        Schema.decodeUnknownOption(HttpContractData)(node.data),
      );

      if (contract !== undefined)
        identities.set(`${contract.root}\0${contract.group}`, {
          root: contract.root,
          group: contract.group,
        });
    }
  }

  const exports = new Map<string, { readonly root: string; readonly group: string }>();
  const diagnosed = new Set<string>();
  const diagnostics: Array<Diagnostic> = [];

  for (const identity of identities.values()) {
    // Each root owns its export namespace; split contracts may reuse group-only names.
    for (const name of [
      groupApiName(identity.group),
      groupClassName(identity.root, identity.group),
      handlerName(identity.root, identity.group),
    ]) {
      const key = `${identity.root}\0${name}`;
      const previous = exports.get(key);

      if (previous !== undefined && previous.group !== identity.group) {
        const pair = [
          `${previous.root}/${previous.group}`,
          `${identity.root}/${identity.group}`,
        ].toSorted();

        const collisionKey = pair.join("\0");

        if (!diagnosed.has(collisionKey)) {
          diagnostics.push(
            HttpDiagnostics.EFFX2406.emit({ name, first: pair[0]!, second: pair[1]! }),
          );
          diagnosed.add(collisionKey);
        }
      } else if (previous === undefined) {
        exports.set(key, identity);
      }
    }
  }

  return diagnostics;
};

export const httpGroupExtension: Extension = extension("http-group", [group], {
  analyses: [validate, validateExportNames],
  expand: expandGroupDefaults,
});
