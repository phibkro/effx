import { Effect, FileSystem, Path, Schema } from "effect";

const repoRoot = new URL("../../", import.meta.url).pathname;

export const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

/** Each acquisition owns a fresh directory until the caller's scope closes. */
export const testDirectory = Effect.fnUntraced(function* (
  prefix: string,
  parent = `${repoRoot}.effx`,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(parent, { recursive: true });

  return yield* fs.makeTempDirectoryScoped({ directory: parent, prefix });
});

const repositoryCopy = Effect.fnUntraced(function* (prefix: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* testDirectory(prefix);

  yield* fs.makeDirectory(path.join(directory, "packages", "frontend-ts"), { recursive: true });

  for (const name of ["diagnostics", "runtime", "compiler", "ir", "cli"])
    yield* fs.symlink(
      path.join(repoRoot, "packages", name),
      path.join(directory, "packages", name),
    );
  yield* fs.symlink(
    path.join(repoRoot, "packages", "frontend-ts", "src"),
    path.join(directory, "packages", "frontend-ts", "src"),
  );
  yield* fs.symlink(path.join(repoRoot, "node_modules"), path.join(directory, "node_modules"));
  yield* fs.symlink(path.join(repoRoot, "scripts"), path.join(directory, "scripts"));

  for (const name of ["package.json", "tsconfig.json"])
    yield* fs.copyFile(path.join(repoRoot, name), path.join(directory, name));

  return directory;
});

/** Copies authored users inputs, never a previous run's generated output. */
export const copyUsersFixture = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const relative = "packages/frontend-ts/test/fixtures/users";
  const source = path.join(repoRoot, relative);
  const directory = path.join(yield* repositoryCopy("users-test-"), relative);
  yield* fs.makeDirectory(directory, { recursive: true });

  yield* fs.copy(path.join(source, "src"), path.join(directory, "src"));
  yield* fs.copyFile(
    path.join(source, "custom-annotations.ts"),
    path.join(directory, "custom-annotations.ts"),
  );
  yield* fs.copyFile(path.join(source, "tsconfig.json"), path.join(directory, "tsconfig.json"));

  return directory;
});

/** The stable Effect 4 copy keeps its target dependencies and checked-in projection seeds. */
export const copyStableV4Fixture = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const relative = "packages/frontend-ts/test/fixtures/stable-v4";
  const source = path.join(repoRoot, relative);
  const directory = path.join(yield* repositoryCopy("stable-v4-test-"), relative);
  yield* fs.makeDirectory(directory, { recursive: true });

  for (const name of yield* fs.readDirectory(source)) {
    if (name === "node_modules") continue;
    yield* fs.copy(path.join(source, name), path.join(directory, name));
  }

  yield* fs.symlink(path.join(source, "node_modules"), path.join(directory, "node_modules"));

  return directory;
});

export const copyUsersExample = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const relative = "examples/users";
  const source = path.join(repoRoot, relative);
  const directory = path.join(yield* repositoryCopy("users-example-test-"), relative);
  yield* fs.makeDirectory(directory, { recursive: true });

  yield* fs.copy(path.join(source, "src"), path.join(directory, "src"));
  yield* fs.copyFile(path.join(source, "tsconfig.json"), path.join(directory, "tsconfig.json"));

  return directory;
});
