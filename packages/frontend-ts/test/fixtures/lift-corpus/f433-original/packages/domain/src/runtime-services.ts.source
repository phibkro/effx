/**
 * Abstract file-system and process requirements for portable domain programs.
 *
 * @since 0.1.0
 */
import { Context, Effect, type PlatformError } from "effect";

export interface DomainFileSystemOperations {
  readonly readTextFile: (path: string) => Effect.Effect<string, PlatformError.PlatformError>;
  readonly joinPath: (directory: string, file: string) => string;
  readonly writeTextFile: (
    path: string,
    contents: string,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly makeTempDirectory: (
    prefix: string,
  ) => Effect.Effect<string, PlatformError.PlatformError>;
  readonly removeTree: (path: string) => Effect.Effect<void, PlatformError.PlatformError>;
}

export class DomainFileSystem extends Context.Service<
  DomainFileSystem,
  DomainFileSystemOperations
>()("@vektorprogrammet/domain/DomainFileSystem") {}

export interface DomainProcessOperations {
  readonly writeStandardOutput: (text: string) => Effect.Effect<void>;
  readonly writeStandardError: (text: string) => Effect.Effect<void>;
}

export class DomainProcess extends Context.Service<DomainProcess, DomainProcessOperations>()(
  "@vektorprogrammet/domain/DomainProcess",
) {}

export const readTextFile = (
  path: string,
): Effect.Effect<string, PlatformError.PlatformError, DomainFileSystem> =>
  DomainFileSystem.use((fileSystem) => fileSystem.readTextFile(path));

export const joinPath = (
  directory: string,
  file: string,
): Effect.Effect<string, never, DomainFileSystem> =>
  DomainFileSystem.use((fileSystem) => Effect.succeed(fileSystem.joinPath(directory, file)));

export const writeTextFile = (
  path: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, DomainFileSystem> =>
  DomainFileSystem.use((fileSystem) => fileSystem.writeTextFile(path, contents));

export const makeTempDirectory = (
  prefix: string,
): Effect.Effect<string, PlatformError.PlatformError, DomainFileSystem> =>
  DomainFileSystem.use((fileSystem) => fileSystem.makeTempDirectory(prefix));

export const removeTree = (
  path: string,
): Effect.Effect<void, PlatformError.PlatformError, DomainFileSystem> =>
  DomainFileSystem.use((fileSystem) => fileSystem.removeTree(path));

export const writeStandardOutput = (text: string): Effect.Effect<void, never, DomainProcess> =>
  DomainProcess.use((process) => process.writeStandardOutput(text));

export const writeStandardError = (text: string): Effect.Effect<void, never, DomainProcess> =>
  DomainProcess.use((process) => process.writeStandardError(text));
