import { build } from "vite";
import tailwind from "@tailwindcss/vite";
const watch = process.argv.includes("--watch") ? {} : null;
await build({
  plugins: [tailwind()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    watch,
    rollupOptions: { input: "sidepanel.html" },
  },
});
for (const name of ["background", "content"])
  await build({
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      watch,
      lib: {
        entry: `src/${name}/index.ts`,
        formats: [name === "content" ? "iife" : "es"],
        name: "Translator",
        fileName: () => `${name}.js`,
      },
    },
  });
