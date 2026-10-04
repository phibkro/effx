import { type Diagnostic, type Location, error, warning } from "./Diagnostic.ts";
import { LOCAL_WIRING, type Surface } from "./surface.ts";

/*
 * Spec 0021 §4: the pure half of `effx surface check`. A frontend establishes WiringFacts from
 * source (static, never executing the program); this module compares them with the surface.
 */

/** A value reference, in a file reachable from the entry, to export `name` of generated module `file`. */
export interface WiringReference {
  readonly file: string;
  readonly name: string;
  readonly location: Location;
}

export interface WiringFacts {
  /** Recognized `Cloudflare.Worker` calls in the reachable files. */
  readonly workers: ReadonlyArray<Location>;
  readonly references: ReadonlyArray<WiringReference>;
  /** Sites where wiring cannot be established statically (spec 0021 §4.2). */
  readonly undecidable: ReadonlyArray<{ readonly location: Location; readonly reason: string }>;
}

export interface GeneratedSource {
  /** Absolute path, normalized the same way the frontend normalizes reference paths. */
  readonly path: string;
  readonly contents: string;
}

const baseName = (file: string): string => file.slice(file.lastIndexOf("/") + 1);

/**
 * The closed set of wiring-capable generated exports: `AppRoutes` of `http.ts` and the
 * `<Group>ApiHandlers` factories of `*-handlers.ts`. Contract, rpc, cli, client, foldkit and
 * guard files export no wiring.
 */
export const isWiringExport = (file: string, name: string): boolean => {
  const base = baseName(file);

  return (
    (base === "http.ts" && name === LOCAL_WIRING) ||
    (base.endsWith("-handlers.ts") && name.endsWith("ApiHandlers"))
  );
};

const definesExport = (contents: string, name: string): boolean =>
  contents.split("\n").some((line) => line.startsWith(`export const ${name} =`));

const key = (file: string, name: string): string => `${file}\u0000${name}`;

const unique = <A>(items: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(items)];

export interface CheckWiringInput {
  readonly surface: Surface;
  readonly generated: ReadonlyArray<GeneratedSource>;
  readonly facts: WiringFacts;
  /** Entry as the user typed it, for messages. */
  readonly entry: string;
}

/** missing = expected ∖ referenced (EFFX2802); extra = referenced ∖ expected (EFFX2803). */
export const checkWiring = (input: CheckWiringInput): ReadonlyArray<Diagnostic> => {
  const { surface, generated, facts, entry } = input;
  const diagnostics: Array<Diagnostic> = [];

  if (facts.workers.length === 0) {
    diagnostics.push(
      error(
        "EFFX2801",
        `${entry} is not, and does not reach, a recognized Alchemy Worker program (a call of Cloudflare.Worker imported from "alchemy/Cloudflare")`,
      ),
    );
  }

  const names = unique([
    ...surface.http.map((group) => group.wiring),
    ...surface.rpc.map((rpc) => rpc.wiring),
  ]);

  const expected = new Map<string, { readonly file: string; readonly name: string }>();

  for (const name of names) {
    for (const file of generated) {
      if (isWiringExport(file.path, name) && definesExport(file.contents, name)) {
        expected.set(key(file.path, name), { file: file.path, name });
      }
    }
  }

  if (expected.size === 0) {
    diagnostics.push({
      code: "EFFX2807",
      severity: "info",
      message:
        "the selected emit mode generates no wiring exports (AppRoutes / <Group>ApiHandlers); nothing to check",
    });
  }

  const referenced = new Map<string, WiringReference>();

  for (const reference of facts.references) {
    if (!isWiringExport(reference.file, reference.name)) continue;

    if (!referenced.has(key(reference.file, reference.name))) {
      referenced.set(key(reference.file, reference.name), reference);
    }
  }

  const sortedExpected = [...expected.entries()].toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const [id, wanted] of sortedExpected) {
    if (!referenced.has(id)) {
      diagnostics.push(
        error(
          "EFFX2802",
          `missing wiring: the surface requires ${wanted.name} (from ${baseName(wanted.file)}) but ${entry} never references it`,
        ),
      );
    }
  }

  const sortedReferenced = [...referenced.entries()].toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const [id, reference] of sortedReferenced) {
    if (!expected.has(id)) {
      diagnostics.push(
        error(
          "EFFX2803",
          `extra wiring: ${reference.name} from ${baseName(reference.file)} is referenced but the current build does not produce it`,
          reference.location,
        ),
      );
    }
  }

  for (const site of facts.undecidable) {
    diagnostics.push(
      warning("EFFX2806", `wiring is not statically decidable here: ${site.reason}`, site.location),
    );
  }

  return diagnostics;
};
