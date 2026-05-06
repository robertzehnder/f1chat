import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Silence "multiple lockfiles" warning caused by a package-lock.json higher up the tree.
  outputFileTracingRoot: path.resolve(__dirname, "../"),
  // Disable webpack's persistent filesystem cache in dev. Next 15's default
  // (`type: "filesystem"`) does an atomic rename of `.pack.gz_` → `.pack.gz`
  // on every recompile, and that rename races itself when:
  //   - multiple `next dev` processes share the same `.next/` directory, OR
  //   - file watcher fires a new compile before the previous one finishes
  //     flushing its pack file.
  // The race surfaces as:
  //   ENOENT: no such file or directory, rename '....pack.gz_' -> '....pack.gz'
  //   ⨯ Error: ENOENT ... '.next/server/app-paths-manifest.json'
  // forcing a manual server restart. Memory cache eliminates the race
  // entirely; the only cost is recompiling from scratch on a fresh boot.
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  }
};

export default nextConfig;
