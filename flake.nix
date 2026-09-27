{
  description = "pi-desktop-notifications — Pi coding agent extension for native desktop notifications on macOS and Linux";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # x86_64-darwin (Intel Mac) not included: nixpkgs 26.11 dropped support for it
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          name = "pi-desktop-notifications-dev";

          packages =
            with pkgs;
            [
              nodejs_22 # pi requires node >= 22.19; npm included for dev dependencies
              git
            ]
            # Tools to exercise the notification backends on each platform.
            # macOS: osascript is a system binary and always present.
            ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
              terminal-notifier # preferred macOS backend
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
              libnotify # notify-send
              dunst # dunstify + reference notification daemon
            ];

          shellHook = ''
            if [ ! -d node_modules ]; then
              echo "pi-desktop-notifications: installing npm dev dependencies..."
              npm install --no-fund --no-audit
            fi
            echo "pi-desktop-notifications dev shell — node $(node --version)"
            echo "test notifications from pi with: /notify test"
          '';
        };
      });
    };
}
