{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = {self, nixpkgs, flake-utils} :
    flake-utils.lib.eachSystem ["x86_64-linux"]
      (system:
        let
          pkgs = import nixpkgs { system = system; };
        in
          {
            # defaultPackage = allPackages.urweb;
            devShell = pkgs.mkShell {
              name = "school-env";
              buildInputs = [pkgs.nodejs_22
                             pkgs.mdbook
                            ];
              shellHook = ''
              '';
            };
          }
      );
}
