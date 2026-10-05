import type { AnalyzeOptions, ObservedInput } from "@effx/compiler";
import type { Path } from "effect";
import { matchFiles, ts } from "./ts.ts";

/**
 * One analysis owns these transient caches. Construction occurs inside tryTs; no
 * writes, callbacks, resources, global host changes or background work are owned here.
 * Disk inputs are captured on first consultation (not an atomic filesystem snapshot).
 * Every later read/probe, including generator resolution, uses that captured value.
 */
export const snapshotHost = (
  path: Path.Path,
  input: AnalyzeOptions,
  savedConfig: readonly [string, string],
) => {
  const absolute = (name: string): string => path.resolve(name);
  const sources = new Map<string, string | undefined>();

  for (const [name, text] of input.sources ?? []) sources.set(absolute(name), text);
  // The selected configuration is always saved, regardless of a mistaken caller overlay.
  sources.set(absolute(savedConfig[0]), savedConfig[1]);
  const texts = new Map<string, string | undefined>();
  const directories = new Map<string, boolean>();
  const identities = new Map<string, string>();
  const physicalSources = new Map<string, string | undefined>();
  const entries = new Map<string, { files: string[]; directories: string[] }>();
  const observed = new Set<string>();
  const virtualDirectories = new Set<string>();

  for (const [name, text] of sources) {
    if (text === undefined) continue;
    let dir = path.dirname(name);

    for (;;) {
      virtualDirectories.add(dir);
      const parent = path.dirname(dir);

      if (parent === dir) break;
      dir = parent;
    }
  }

  const observe = (kind: ObservedInput["kind"], name: string): void => {
    const key = kind + ":" + name;

    if (observed.has(key)) return;
    observed.add(key);
    input.onObserve?.({ kind, path: name });
  };

  const directoryExists = (name: string): boolean => {
    const dir = absolute(name);

    if (!directories.has(dir))
      directories.set(dir, virtualDirectories.has(dir) || ts.sys.directoryExists(dir));
    const exists = directories.get(dir) === true;
    observe(exists ? "directory" : "missing", dir);

    if (!exists) observeParents(dir);

    return exists;
  };

  const observeParents = (name: string): void => {
    let parent = path.dirname(name);

    for (;;) {
      if (!directories.has(parent)) directories.set(parent, ts.sys.directoryExists(parent));
      const exists = directories.get(parent) === true;
      observe(exists ? "directory" : "missing", parent);
      const next = path.dirname(parent);

      if (exists || next === parent) break;
      parent = next;
    }
  };

  const readFile = (name: string): string | undefined => {
    const file = absolute(name);

    if (!texts.has(file)) {
      const captured = sources.has(file)
        ? sources.get(file)
        : physicalSources.has(file)
          ? physicalSources.get(file)
          : ts.sys.readFile(file);

      texts.set(file, captured);

      if (captured !== undefined) input.onReadSource?.(file, captured);
    }

    const text = texts.get(file);
    observe(text === undefined ? "missing" : "file", file);

    if (text === undefined) observeParents(file);

    if (text !== undefined) realpath(file);

    return text;
  };

  const realpath = (name: string): string => {
    const logical = absolute(name);

    if (!identities.has(logical)) identities.set(logical, ts.sys.realpath?.(logical) ?? logical);
    const physical = identities.get(logical) ?? logical;

    if (sources.has(logical)) physicalSources.set(physical, sources.get(logical));

    if (physical !== logical) {
      observe("symlink", logical);
      observe(
        (directories.get(logical) ?? ts.sys.directoryExists(logical)) ? "directory" : "file",
        physical,
      );
    }

    return physical;
  };

  const getEntries = (name: string) => {
    const dir = absolute(name);
    const cached = entries.get(dir);

    if (cached !== undefined) return cached;
    const exists = directoryExists(dir);

    const files = new Set(
      exists
        ? ts.sys
            .readDirectory(dir, undefined, undefined, ["*"], 1)
            .map((file) => path.basename(file))
        : [],
    );

    const children = new Set(
      exists ? ts.sys.getDirectories(dir).map((child) => path.basename(child)) : [],
    );

    for (const [file, text] of sources) {
      if (path.dirname(file) === dir) {
        if (text === undefined) files.delete(path.basename(file));
        else files.add(path.basename(file));
      }
    }

    for (const child of virtualDirectories)
      if (child !== dir && path.dirname(child) === dir) children.add(path.basename(child));
    const result = { files: [...files], directories: [...children] };
    entries.set(dir, result);

    return result;
  };

  const readDirectory: ts.System["readDirectory"] = (root, extensions, excludes, includes, depth) =>
    matchFiles(
      absolute(root),
      extensions,
      excludes,
      includes,
      ts.sys.useCaseSensitiveFileNames,
      ts.sys.getCurrentDirectory(),
      depth,
      getEntries,
      realpath,
    );

  const host = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readFile,
    fileExists: (name: string) => readFile(name) !== undefined,
    directoryExists,
    realpath,
    readDirectory,
    getDirectories: (name: string) => getEntries(name).directories,
  } satisfies ts.ParseConfigHost & ts.ModuleResolutionHost;

  readFile(savedConfig[0]);

  return host;
};
