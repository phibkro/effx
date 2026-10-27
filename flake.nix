{
  description = "Pinned Alloy 6 model checker for effx";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/1f607aa79b6356ed45d3cd3c8079c196e79efa2c";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
    in {
      packages = nixpkgs.lib.genAttrs systems (system: {
        alloy6 = nixpkgs.legacyPackages.${system}.alloy6;
      });
    };
}
