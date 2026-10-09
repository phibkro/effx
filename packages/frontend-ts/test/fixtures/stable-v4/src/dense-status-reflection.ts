import effectPackage from "effect/package.json";
import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import { ProfileApi as ExplicitProfileApi } from "../project/status-explicit/.effx/generated/profile-contract.js";
import { DirectoryApi as ExplicitDirectoryApi } from "../project/status-explicit/.effx/generated/directory-contract.js";
import { ContentApi as ExplicitContentApi } from "../project/status-explicit/.effx/generated/content-contract.js";
import { ProfileApi as ConsumerProfileApi } from "../project/status-consumer/.effx/generated/profile-contract.js";
import { DirectoryApi as ConsumerDirectoryApi } from "../project/status-consumer/.effx/generated/directory-contract.js";
import { ContentApi as ConsumerContentApi } from "../project/status-consumer/.effx/generated/content-contract.js";

const reflect = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
) => {
  const operations: Array<{
    group: string;
    key: string;
    method: string;
    path: string;
    successes: Array<number>;
    errors: Array<number>;
  }> = [];
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, successes, errors }) => {
      operations.push({
        group: group.identifier,
        key: endpoint.identifier,
        method: endpoint.method,
        path: endpoint.path,
        successes: [...successes.keys()].toSorted((a, b) => a - b),
        errors: [...errors.keys()].toSorted((a, b) => a - b),
      });
    },
  });
  return {
    openapi: OpenApi.fromApi(api),
    operations: operations.toSorted((a, b) => a.key.localeCompare(b.key)),
  };
};

export const compareDenseStatus = () => ({
  effect: {
    version: effectPackage.version,
    moduleOrigin: import.meta.resolve("effect/unstable/httpapi"),
  },
  explicit: reflect(
    HttpApi.make("external-native-api").add(
      ExplicitProfileApi,
      ExplicitDirectoryApi,
      ExplicitContentApi,
    ),
  ),
  consumer: reflect(
    HttpApi.make("external-native-api").add(
      ConsumerProfileApi,
      ConsumerDirectoryApi,
      ConsumerContentApi,
    ),
  ),
});
