import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");
const app = express();
const maxBytes = 100 * 1024 * 1024;
const maxConcurrent = 2;
const maxQueued = 10;
const activeJobs = { count: 0, waiting: [] };
let cachedGhostscriptPath = null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes, files: 1, fields: 3, parts: 4 }
});

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-origin" } }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(publicDir, { extensions: ["html"] }));

function acquireJob() {
  if (activeJobs.count < maxConcurrent) {
    activeJobs.count += 1;
    return Promise.resolve();
  }
  if (activeJobs.waiting.length >= maxQueued) {
    const error = new Error("The compressor is busy. Please try again shortly.");
    error.status = 503;
    return Promise.reject(error);
  }
  return new Promise((resolve) => activeJobs.waiting.push(resolve));
}

function releaseJob() {
  const next = activeJobs.waiting.shift();
  if (next) next();
  else activeJobs.count -= 1;
}

async function getGhostscriptPath() {
  if (cachedGhostscriptPath) return cachedGhostscriptPath;
  if (process.env.GS_PATH) {
    cachedGhostscriptPath = process.env.GS_PATH;
    return cachedGhostscriptPath;
  }
  if (process.platform !== "win32") {
    cachedGhostscriptPath = "gs";
    return cachedGhostscriptPath;
  }

  const roots = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "gs"),
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "gs") : null
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push({
          version: entry.name,
          executable: path.join(root, entry.name, "bin", "gswin64c.exe")
        });
      }
    }
  }
  candidates.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
  for (const candidate of candidates) {
    try {
      await access(candidate.executable);
      cachedGhostscriptPath = candidate.executable;
      return cachedGhostscriptPath;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  cachedGhostscriptPath = "gswin64c";
  return cachedGhostscriptPath;
}

async function runGhostscript(inputPath, outputPath, { dpi, quality, preset }) {
  const executable = await getGhostscriptPath();
  const args = [
    "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
    `-dPDFSETTINGS=/${preset}`, "-dCompatibilityLevel=1.5",
    "-dDownsampleColorImages=true", "-dDownsampleGrayImages=true",
    "-dDownsampleMonoImages=true", "-dColorImageDownsampleType=/Bicubic",
    "-dGrayImageDownsampleType=/Bicubic", `-dColorImageResolution=${dpi}`,
    `-dGrayImageResolution=${dpi}`, `-dJPEGQ=${quality}`,
    `-sOutputFile=${outputPath}`, inputPath
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let errorOutput = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { errorOutput += chunk.slice(0, 4000); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      const startupError = new Error(error.code === "ENOENT" ? "Ghostscript is not installed or GS_PATH is incorrect." : `Ghostscript could not start: ${error.message}`);
      if (error.code === "ENOENT") startupError.status = 503;
      reject(startupError);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (signal) return reject(new Error("Ghostscript timed out while processing this PDF."));
      if (code !== 0) return reject(new Error(`Ghostscript could not compress this PDF. ${errorOutput.trim()}`));
      resolve();
    });
  });
}

function validPdf(buffer) {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

async function compressFile(file, mode, level, targetBytes, directory) {
  const inputPath = path.join(directory, `${crypto.randomUUID()}-input.pdf`);
  const outputPath = path.join(directory, `${crypto.randomUUID()}-output.pdf`);
  await writeFile(inputPath, file.buffer, { flag: "wx" });
  if (mode === "target" && targetBytes >= file.size) return inputPath;
  if (mode === "level") {
    const settings = {
      low: { dpi: 150, quality: 85, preset: "prepress" },
      medium: { dpi: 110, quality: 65, preset: "ebook" },
      high: { dpi: 72, quality: 45, preset: "screen" }
    };
    const selected = settings[level];
    if (!selected) {
      const error = new Error("Select a valid compression level.");
      error.status = 400;
      throw error;
    }
    await runGhostscript(inputPath, outputPath, selected);
  } else {
    const resolutions = [150, 110, 72, 48];
    let smallest = null;
    let bestUnderTarget = null;
    const candidates = new Set();
    let targetReached = false;
    for (let resolutionIndex = 0; resolutionIndex < resolutions.length && !targetReached; resolutionIndex += 1) {
      let low = 35;
      let high = 90;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const quality = Math.round((low + high) / 2);
        const candidatePath = path.join(directory, `${crypto.randomUUID()}-candidate.pdf`);
        await runGhostscript(inputPath, candidatePath, {
          dpi: resolutions[resolutionIndex], quality, preset: resolutionIndex < 2 ? "ebook" : "screen"
        });
        const candidate = { path: candidatePath, size: (await stat(candidatePath)).size };
        candidates.add(candidatePath);
        if (!smallest || candidate.size < smallest.size) smallest = candidate;
        if (candidate.size <= targetBytes && (!bestUnderTarget || candidate.size > bestUnderTarget.size)) {
          bestUnderTarget = candidate;
        }
        const retained = new Set([smallest?.path, bestUnderTarget?.path].filter(Boolean));
        for (const oldPath of candidates) {
          if (!retained.has(oldPath)) {
            await rm(oldPath, { force: true });
            candidates.delete(oldPath);
          }
        }
        if (candidate.size <= targetBytes) {
          targetReached = true;
          low = quality + 1;
        } else {
          high = quality - 1;
        }
      }
    }
    const best = bestUnderTarget || smallest;
    if (!best) throw new Error("Ghostscript produced no compressed output.");
    await writeFile(outputPath, await readFile(best.path), { flag: "wx" });
    for (const candidatePath of candidates) await rm(candidatePath, { force: true });
  }
  const outputSize = (await stat(outputPath)).size;
  if (outputPath !== inputPath && outputSize >= file.size) {
    await rm(outputPath, { force: true });
    return inputPath;
  }
  return outputPath;
}

app.post("/api/compress", upload.single("file"), async (request, response, next) => {
  let jobAcquired = false;
  let directory;
  try {
    if (!request.file) return response.status(400).json({ error: "Select a PDF file." });
    if (!validPdf(request.file.buffer)) return response.status(400).json({ error: "The uploaded file is not a valid PDF." });
    const mode = request.body.mode;
    const targetBytes = Number(request.body.targetKb) * 1024;
    if (mode !== "level" && mode !== "target") return response.status(400).json({ error: "Select a valid compression mode." });
    if (mode === "target" && (!Number.isFinite(targetBytes) || targetBytes < 10 * 1024 || targetBytes > maxBytes)) {
      return response.status(400).json({ error: "Target size must be between 10 KB and 102400 KB." });
    }
    await acquireJob();
    jobAcquired = true;
    directory = await mkdtemp(path.join(os.tmpdir(), "pdf-compress-"));
    const outputPath = await compressFile(request.file, mode, request.body.level, targetBytes, directory);
    const outputSize = (await stat(outputPath)).size;
    if (mode === "target") {
      response.setHeader("X-Already-Smaller", String(targetBytes >= request.file.size));
      response.setHeader("X-Target-Reached", String(outputSize <= targetBytes));
    }
    const downloadName = `${path.basename(request.file.originalname, path.extname(request.file.originalname))}-compressed.pdf`;
    const jobDirectory = directory;
    const didNotReduce = outputSize >= request.file.size;
    response.setHeader("X-Not-Reduced", String(didNotReduce));
    response.download(outputPath, downloadName, (error) => {
      if (error && !response.headersSent) next(error);
      void rm(jobDirectory, { recursive: true, force: true })
        .catch((cleanupError) => console.error("Could not remove temporary PDF files.", cleanupError))
        .finally(releaseJob);
    });
    directory = undefined;
    jobAcquired = false;
  } catch (error) {
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("Could not remove temporary PDF files.", cleanupError);
      }
    }
    if (jobAcquired) releaseJob();
    next(error);
  }
});

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "PDFs must be 100 MB or smaller."
      : "The upload contains too many fields or files.";
    return response.status(status).json({ error: message });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  response.status(status).json({ error: status === 500 ? "PDF compression failed. Check the server logs and Ghostscript installation." : error.message });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`PDF compressor listening on port ${port}`));
