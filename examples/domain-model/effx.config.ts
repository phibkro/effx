import { defineConfig } from "@effx/cli/config";
import { domainModel } from "@effx/domain-model";
import { domain } from "./domain.ts";

export default defineConfig({
  project: "tsconfig.json",
  models: { alloy: true },
  extensions: [domainModel(domain)],
});
