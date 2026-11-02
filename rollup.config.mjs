import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { builtinModules } from "node:module";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.rolltray.midideck.sdPlugin";

/** @type {import('rollup').RollupOptions} */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "es",
		sourcemap: isWatching,
	},
	external: [
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
		"electron",
	],
	plugins: [
		typescript({
			tsconfig: "./tsconfig.json",
			noEmit: false,
			sourceMap: isWatching,
			inlineSources: isWatching,
		}),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true,
		}),
		commonjs(),
		!isWatching && terser({ format: { comments: false } }),
	],
};

export default config;
