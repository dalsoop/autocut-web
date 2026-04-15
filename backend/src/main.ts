import express from "express"
import path from "path"
import { promises as fs } from "fs"
import { fileURLToPath } from "url"

import {
  assertJobSubmit, assertCut,
  stringifyStatus, stringifyFiles, stringifySubtitle, stringifySynology,
} from "./types.js"
import {
  transcribe, cut, getJob, listJobs, listFiles,
  getSubtitle, listSynology,
  listProjects, loadConfig, saveConfig,
  PROJECTS_ROOT, resolveAbsolute,
} from "./jobs.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = path.resolve(__dirname, "../../frontend/public")

const app = express()
app.use(express.json({ limit: "10mb" }))

app.get("/api/projects", async (_req, res) => {
  res.json(await listProjects())
})

app.get("/api/config", async (_req, res) => {
  res.json(await loadConfig())
})

app.post("/api/config", async (req, res) => {
  const ap = req.body?.activeProject
  if (typeof ap !== "string") return res.status(400).json({ error: "activeProject required" })
  await saveConfig({ activeProject: ap })
  res.json({ ok: true })
})

app.get("/api/files", async (_req, res) => {
  res.type("application/json").send(stringifyFiles(await listFiles()))
})

app.get("/api/subtitle/*", async (req, res) => {
  try {
    const filename = decodeURIComponent((req.params as any)[0])
    const data = await getSubtitle(filename)
    res.type("application/json").send(stringifySubtitle(data))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get("/api/media/*", async (req, res) => {
  try {
    const rel = decodeURIComponent((req.params as any)[0])
    const abs = await resolveAbsolute(rel)
    res.sendFile(abs)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get("/api/synology", async (req, res) => {
  try {
    const p = typeof req.query.path === "string" ? req.query.path : ""
    const data = await listSynology(p)
    res.type("application/json").send(stringifySynology(data))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.delete("/api/media/*", async (req, res) => {
  try {
    const rel = decodeURIComponent((req.params as any)[0])
    const abs = await resolveAbsolute(rel)
    await fs.unlink(abs).catch(() => {})
    await fs.unlink(abs + ".json").catch(() => {})
    res.json({ ok: true })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
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
  console.log(`[autocut-web] :${PORT}  PROJECTS_ROOT=${PROJECTS_ROOT}`)
})
