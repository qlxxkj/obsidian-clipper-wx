import esbuild from "esbuild";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

/**
 * Bundle src/main.ts into main.js (Obsidian plugin entry).
 * 依赖 defuddle + linkedom 会被打进 bundle;obsidian 保持 external。
 */
const external = ["obsidian", "electron", "electron/node"];

const opts = {
    entryPoints: ["src/main.ts"],
    bundle: true,
    external,
    format: "cjs",
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    platform: "node",
    outfile: "main.js",
};

const build = () =>
    esbuild.build({
        ...opts,
        define: { "process.env.NODE_ENV": prod ? '"production"' : '"development"' },
    });

if (prod) {
    await build();
} else {
    await build();
    esbuild.context(opts).then((ctx) => ctx.watch());
}
