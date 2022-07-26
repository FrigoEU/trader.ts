{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/21.05";
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
              buildInputs = [pkgs.nodejs-14_x];
              shellHook = ''
              '';
            };
          }
      );
}
