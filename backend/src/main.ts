import express from "express"
import multer from "multer"
import path from "path"
import { promises as fs } from "fs"
import { fileURLToPath } from "url"

import {
  assertJobSubmit, assertCut, assertImport,
  stringifyStatus, stringifyFiles, stringifySubtitle, stringifySynology,
} from "./types.js"
import {
  transcribe, cut, getJob, listJobs, listFiles,
  getSubtitle, listSynology, importFromSynology,
  INPUT_DIR, OUTPUT_DIR,
} from "./jobs.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = path.resolve(__dirname, "../../frontend/public")

const app = express()
app.use(express.json({ limit: "10mb" }))

const upload = multer({
  dest: INPUT_DIR,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
})

app.post("/api/upload", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" })
  const final = path.join(INPUT_DIR, req.file.originalname)
  await fs.rename(req.file.path, final)
  res.json({ filename: req.file.originalname, size: req.file.size })
})

app.get("/api/files", async (_req, res) => {
  res.type("application/json").send(stringifyFiles(await listFiles()))
})

app.get("/api/subtitle/:filename", async (req, res) => {
  try {
    const data = await getSubtitle(req.params.filename)
    res.type("application/json").send(stringifySubtitle(data))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get("/api/input/:name", (req, res) => {
  res.sendFile(path.join(INPUT_DIR, req.params.name))
})
app.get("/api/output/:name", (req, res) => {
  res.sendFile(path.join(OUTPUT_DIR, req.params.name))
})

// Synology 브라우저
app.get("/api/synology", async (req, res) => {
  try {
    const p = typeof req.query.path === "string" ? req.query.path : ""
    const data = await listSynology(p)
    res.type("application/json").send(stringifySynology(data))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// Synology → input 복사
app.post("/api/synology/import", async (req, res) => {
  try {
    const body = assertImport(req.body)
    const job = await importFromSynology(body.path)
    res.type("application/json").send(stringifyStatus(job))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// 파일 삭제
app.delete("/api/input/:name", async (req, res) => {
  const name = req.params.name
  const base = name.replace(/\.[^.]+$/, "")
  for (const ext of ["", ".srt", ".md"]) {
    await fs.unlink(path.join(INPUT_DIR, base + ext)).catch(() => {})
  }
  await fs.unlink(path.join(INPUT_DIR, name)).catch(() => {})
  res.json({ ok: true })
})

app.delete("/api/output/:name", async (req, res) => {
  const name = req.params.name
  if (name.includes("/") || name.includes("..")) { res.status(400).json({ error: "invalid name" }); return }
  await fs.unlink(path.join(OUTPUT_DIR, name)).catch(() => {})
  await fs.unlink(path.join(OUTPUT_DIR, `${name}.json`)).catch(() => {})
  res.json({ ok: true })
})

app.post("/api/jobs/transcribe", async (req, res) => {
  try {
    const body = assertJobSubmit(req.body)
    const job = await transcribe(body.filename, body.whisperModel, body.lang)
    res.type("application/json").send(stringifyStatus(job))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.post("/api/jobs/cut", async (req, res) => {
  try {
    const body = assertCut(req.body)
    const job = await cut(body.filename, body.keepIndices)
    res.type("application/json").send(stringifyStatus(job))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: "not found" })
  res.type("application/json").send(stringifyStatus(job))
})

app.get("/api/jobs", (_req, res) => res.json(listJobs()))

app.use(express.static(FRONTEND_DIR))
app.get("*", (_req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")))

const PORT = parseInt(process.env.PORT || "8080")
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[autocut-web] :${PORT}  INPUT=${INPUT_DIR}  OUTPUT=${OUTPUT_DIR}`)
})
