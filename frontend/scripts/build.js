import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(frontendDir, "dist");
const configuredApiUrl = process.env.VITE_API_BASE_URL?.trim();

if (!configuredApiUrl) {
  throw new Error("Set VITE_API_BASE_URL to the Render backend's HTTPS origin before building.");
}

let apiUrl;
try {
  apiUrl = new URL(configuredApiUrl);
} catch {
  throw new Error("VITE_API_BASE_URL must be a valid backend origin.");
}

const isLocalHttp = apiUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(apiUrl.hostname);
if ((!isLocalHttp && apiUrl.protocol !== "https:") || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash) {
  throw new Error("VITE_API_BASE_URL must be an HTTPS origin without a path, query, or fragment.");
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of await readdir(frontendDir, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.endsWith(".html") || ["robots.txt", "sitemap.xml"].includes(entry.name))) {
    await cp(path.join(frontendDir, entry.name), path.join(outputDir, entry.name));
  } else if (entry.isDirectory() && ["css", "js"].includes(entry.name)) {
    await cp(path.join(frontendDir, entry.name), path.join(outputDir, entry.name), { recursive: true });
  }
}

await writeFile(
  path.join(outputDir, "api-config.js"),
  `window.PDF_COMPRESSOR_API_BASE_URL = ${JSON.stringify(apiUrl.origin)};\n`
);
