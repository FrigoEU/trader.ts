import { builtinModules } from "./builtinmodules.js";
import esbuild from "esbuild";

esbuild
  .build({
    entryPoints: ["src/clientcomponents.ts"],
    bundle: true,
    platform: "browser",
    outdir: "out",
    jsxFactory: "h",
    plugins: [nodeModulesAreSideEffectFreeInBrowserPlugin()],
  })
  .catch(() => process.exit(1));

esbuild
  .build({
    entryPoints: ["src/server.tsx"],
    bundle: true,
    platform: "node",
    outdir: "out",
    jsxFactory: "h",
    plugins: [],
  })
  .catch(() => process.exit(1));

function nodeModulesAreSideEffectFreeInBrowserPlugin() {
  const builtinList = builtinModules.join("|");
  const builtinRegexp = new RegExp(`^(${builtinList})\\/?(.+)?`);

  return {
    name: "nodeModulesAreSideEffectFreeInBrowserPlugin",
    setup: function (build) {
      build.onResolve({ filter: builtinRegexp }, (args) => ({
        path: args.path,
        external: true,
        sideEffects: false,
      })),
        build.onLoad({ filter: /.*/, namespace: "entry" }, () => ({
          contents: ``,
        }));
    },
  };
}
