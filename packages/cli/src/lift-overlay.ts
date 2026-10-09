import { Effect, FileSystem, Option, Path, Schema, type PlatformError, type Scope } from "effect";
import { CompilerFault } from "@effx/compiler";

/*
 * The scoped overlay of spec 0019 §2.4 steps 1-3: one throwaway directory holding a copy of the effx
 * project the lifted group belongs to, the verified refactor results and the suggestion. Only this scope
 * is written; the original project is read. `node_modules` directories on the project's ancestor chain are
 * shared by read-only symlink, so the original and the overlay modules resolve one Effect installation.
 * Secret-bearing files (dotenv files, registry configuration) and the VCS directory are never copied, and
 * symlinks inside the project are recreated against their resolved real targets.
 */

/** The overlay cannot be built for a reason that is data (a file outside the project root), not an IO fault. */
export class OverlayUnavailable extends Schema.TaggedError<OverlayUnavailable>()(
  "OverlayUnavailable",
  { detail: Schema.String },
) {}

/** Everything one overlay needs; every path is absolute and refers to the ORIGINAL project. */
export interface OverlayInput {
  readonly projectRoot: string;
  readonly tsconfigPath: string;
  /** Verified refactor results (`applyRefactors`): original absolute file and its patched text. */
  readonly patched: ReadonlyArray<{ readonly file: string; readonly contents: string }>;
  /** The suggestion exactly as the shared printer produced it, at its original absolute path. */
  readonly suggestion: { readonly file: string; readonly contents: string };
}

/** The built overlay: absolute overlay paths, plus the pure mapping from original files into it. */
export interface Overlay {
  /** The temp directory that mirrors the highest ancestor holding a `node_modules`. */
  readonly root: string;
  /** The overlay copy of the project root. */
  readonly projectRoot: string;
  /** The overlay compile project: the copied tsconfig is extended and its program narrowed to the suggestion. */
  readonly tsconfigPath: string;
  /** `.effx/generated` of the overlay project. */
  readonly outDir: string;
  readonly suggestionFile: string;
  /** The overlay file of an original file, or none when the original lies outside the project root. */
  readonly locate: (original: string) => Option.Option<string>;
  /** Writes a generated file below the overlay project root and returns its absolute path. */
  readonly writeFile: (relative: string, contents: string) => Effect.Effect<string, CompilerFault>;
  /**
   * Writes `<name>` beside the compile project: it extends the copied tsconfig and narrows the program to
   * exactly these absolute overlay files. Returns the absolute path of the new project.
   */
  readonly writeProject: (
    name: string,
    files: ReadonlyArray<string>,
  ) => Effect.Effect<string, CompilerFault>;
}

const OverlayConfig = Schema.fromJsonString(
  Schema.Struct({
    extends: Schema.String,
    include: Schema.Array(Schema.String),
    files: Schema.Array(Schema.String),
    compilerOptions: Schema.Struct({ noEmit: Schema.Boolean }),
  }),
);

const encodeOverlayConfig = Schema.encodeEffect(OverlayConfig);

/** Names that are never copied: VCS state and anything that can carry credentials or runtime config. */
const isExcluded = (name: string): boolean =>
  name === ".git" ||
  name === "node_modules" ||
  name === "bunfig.toml" ||
  name === ".npmrc" ||
  name === ".netrc" ||
  name === ".env" ||
  name.startsWith(".env.");

const fault = (message: string, cause?: unknown): CompilerFault =>
  cause === undefined
    ? new CompilerFault({ stage: "lift", message: `overlay: ${message}` })
    : new CompilerFault({ stage: "lift", message: `overlay: ${message}`, cause });

const io = <A, R>(
  what: string,
  effect: Effect.Effect<A, PlatformError.PlatformError, R>,
): Effect.Effect<A, CompilerFault, R> =>
  effect.pipe(Effect.mapError((cause) => fault(`cannot ${what}: ${cause._tag}`, cause)));

const copyTree = Effect.fnUntraced(function* (
  from: string,
  to: string,
): Effect.fn.Return<void, CompilerFault, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* io("create a directory", fs.makeDirectory(to, { recursive: true }));

  const names = yield* io("read a directory", fs.readDirectory(from));

  yield* Effect.forEach(
    names.toSorted().filter((name) => !isExcluded(name)),
    (name) =>
      Effect.gen(function* () {
        const source = path.join(from, name);
        const destination = path.join(to, name);
        const link = yield* Effect.option(fs.readLink(source));

        if (Option.isSome(link)) {
          // A link keeps pointing at its real target: shared and read-only. A dangling link is not copied.
          const real = yield* Effect.option(fs.realPath(source));

          if (Option.isSome(real))
            yield* io("recreate a link", fs.symlink(real.value, destination));

          return;
        }

        const stat = yield* io("stat an entry", fs.stat(source));

        if (stat.type === "Directory") return yield* copyTree(source, destination);

        if (stat.type === "File") yield* io("copy a file", fs.copyFile(source, destination));
      }),
    { concurrency: 16, discard: true },
  );
});

const ancestorsOf = (path: Path.Path, start: string): ReadonlyArray<string> => {
  const chain: Array<string> = [];

  for (let current = start; ;) {
    chain.push(current);
    const parent = path.dirname(current);

    if (parent === current) return chain;

    current = parent;
  }
};

const isInside = (path: Path.Path, root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);

  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
};

/**
 * Builds the overlay in a scoped temp directory that disappears with the caller's scope. Unavailable
 * (data) when the suggestion or a refactored file does not live inside the project root, because its
 * module keys could not be mirrored; IO failures stay `CompilerFault`.
 */
export const makeOverlay = Effect.fn("lift.makeOverlay")(function* (
  input: OverlayInput,
): Effect.fn.Return<
  Overlay,
  OverlayUnavailable | CompilerFault,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const root = yield* io(
    "create the overlay directory",
    fs.makeTempDirectoryScoped({ prefix: "effx-lift-check-" }),
  );

  const sharing = yield* Effect.filter(ancestorsOf(path, input.projectRoot), (ancestor) =>
    io("look for node_modules", fs.exists(path.join(ancestor, "node_modules"))),
  );

  // The overlay mirrors the path from the highest `node_modules` ancestor down to the project root, so the
  // Node resolution walk from an overlay file meets the same shared installations as the original does.
  const top = sharing.at(-1) ?? input.projectRoot;

  const mirror = (original: string): string => path.join(root, path.relative(top, original));

  const projectRoot = mirror(input.projectRoot);

  yield* io("create the project directory", fs.makeDirectory(projectRoot, { recursive: true }));

  yield* Effect.forEach(
    sharing,
    (ancestor) =>
      Effect.gen(function* () {
        const real = yield* io(
          "resolve node_modules",
          fs.realPath(path.join(ancestor, "node_modules")),
        );

        yield* io(
          "link node_modules",
          fs.symlink(real, path.join(mirror(ancestor), "node_modules")),
        );
      }),
    { discard: true },
  );

  yield* copyTree(input.projectRoot, projectRoot);

  const locate = (original: string): Option.Option<string> =>
    original === input.projectRoot || isInside(path, input.projectRoot, original)
      ? Option.some(path.join(projectRoot, path.relative(input.projectRoot, original)))
      : Option.none();

  const writeFile = (relative: string, contents: string) =>
    Effect.gen(function* () {
      const target = path.join(projectRoot, relative);

      yield* io("create a directory", fs.makeDirectory(path.dirname(target), { recursive: true }));
      yield* io("write a file", fs.writeFileString(target, contents));

      return target;
    });

  const place = Effect.fnUntraced(function* (original: string, contents: string, what: string) {
    const target = locate(original);

    if (Option.isNone(target))
      return yield* new OverlayUnavailable({
        detail: `${what} ${original} is outside the project root ${input.projectRoot}`,
      });

    yield* io(
      "create a directory",
      fs.makeDirectory(path.dirname(target.value), { recursive: true }),
    );
    yield* io("write a file", fs.writeFileString(target.value, contents));

    return target.value;
  });

  for (const patched of input.patched)
    yield* place(patched.file, patched.contents, "the refactored file");

  const suggestionFile = yield* place(
    input.suggestion.file,
    input.suggestion.contents,
    "the suggestion",
  );

  const copiedConfig = locate(input.tsconfigPath);

  const projectsDirectory = Option.match(copiedConfig, {
    onNone: () => projectRoot,
    onSome: (copied) => path.dirname(copied),
  });

  const writeProject = (name: string, files: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const target = path.join(projectsDirectory, name);

      const extended = Option.match(copiedConfig, {
        onNone: () => input.tsconfigPath,
        onSome: (copied) => {
          const relative = path.relative(projectsDirectory, copied);

          return relative.startsWith(".") ? relative : `./${relative}`;
        },
      });

      const contents = yield* encodeOverlayConfig({
        extends: extended,
        include: [],
        files: files.map((file) => path.relative(projectsDirectory, file)),
        compilerOptions: { noEmit: true },
      }).pipe(Effect.mapError((cause) => fault("invalid compile project", cause)));

      yield* io("write a compile project", fs.writeFileString(target, contents));

      return target;
    });

  const tsconfigPath = yield* writeProject("tsconfig.effx-lift.json", [suggestionFile]);

  const outDir = path.join(projectRoot, ".effx", "generated");

  yield* io("create the generated directory", fs.makeDirectory(outDir, { recursive: true }));

  return {
    root,
    projectRoot,
    tsconfigPath,
    outDir,
    suggestionFile,
    locate,
    writeFile,
    writeProject,
  };
});
