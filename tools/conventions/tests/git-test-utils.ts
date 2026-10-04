export type GitTestSpawnOptions = {
  cmd: string[];
  cwd: string;
  stdout: "pipe";
  stderr: "pipe";
};

/** Removes Git's caller context while keeping host tools and paths available to the test. */
export const createGitTestSpawner = (home: string) => {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(Bun.env)) {
    if (!key.startsWith("GIT_") && value !== undefined) {
      env[key] = value;
    }
  }

  env.GIT_CONFIG_NOSYSTEM = "1";
  env.HOME = home;

  return (options: GitTestSpawnOptions) => Bun.spawnSync({ ...options, env });
};
