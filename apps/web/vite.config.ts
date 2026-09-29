import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Docker builds have no .git, so they pass the commit in ATLAS_VERSION (from Coolify's SOURCE_COMMIT).
function version(): string {
  if (process.env.ATLAS_VERSION) return process.env.ATLAS_VERSION
  const git = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { stderr: "ignore" })
  return git.success ? git.stdout.toString().trim() : "dev"
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: { __ATLAS_VERSION__: JSON.stringify(version()) },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
