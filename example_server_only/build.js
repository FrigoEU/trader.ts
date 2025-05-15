import esbuild from "esbuild";

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
