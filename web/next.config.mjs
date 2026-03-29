import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Silence "multiple lockfiles" warning caused by a package-lock.json higher up the tree.
  outputFileTracingRoot: path.resolve(__dirname, "../")
};

export default nextConfig;
