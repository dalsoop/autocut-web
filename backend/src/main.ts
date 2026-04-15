import express from "express"
import path from "path"
import { promises as fs } from "fs"
import { fileURLToPath } from "url"

import {
  assertJobSubmit, assertCut,
  stringifyStatus, stringifyFiles, stringifySubtitle, stringifySynology,
} from "./types.js"
import {
  transcribe, cut, getJob, listJobs, listFiles, cancelJob,
  getSubtitle, listSynology,
  listProjects, loadConfig, saveConfig,
  listPendingTranscribe,
  editLines, splitLine, mergeNext, getVtt, nudgeLine,
  listSubtitleVersions, activateSubtitleVersion,
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
  const b = req.body || {}
  const patch: any = {}
  if (typeof b.activeProject === "string") patch.activeProject = b.activeProject
  if (b.defaultEngine === "whisper" || b.defaultEngine === "qwen3") patch.defaultEngine = b.defaultEngine
  if (["Korean", "English", "Japanese", "zh"].includes(b.defaultLang)) patch.defaultLang = b.defaultLang
  if (typeof b.defaultWhisperModel === "string") patch.defaultWhisperModel = b.defaultWhisperModel
  if (typeof b.qwen3Device === "string" && /^cuda:\d+$|^cpu$/.test(b.qwen3Device)) patch.qwen3Device = b.qwen3Device
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "no valid fields" })
  await saveConfig(patch)
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
    // 원본 영상 삭제 시 연관 파일 전부 정리
    const base = abs.replace(/\.[^.]+$/, "")
    const fileBase = path.basename(base)
    const dir = path.dirname(abs)
    const isOriginal = !fileBase.includes("_cut")
    await fs.unlink(abs).catch(() => {})
    await fs.unlink(abs + ".json").catch(() => {})
    if (isOriginal) {
      // 자막/메타/버전폴더/MD 전부
      for (const ext of [".srt", ".md", ".srt.meta.json", ".vtt"]) {
        await fs.unlink(base + ext).catch(() => {})
      }
      await fs.rm(base + "_subs", { recursive: true, force: true }).catch(() => {})
      // 같은 폴더의 이 원본에서 파생된 _cut_ 결과물들
      const names = await fs.readdir(dir).catch(() => [])
      for (const n of names) {
        if (n.startsWith(fileBase + "_cut_")) {
          await fs.unlink(path.join(dir, n)).catch(() => {})
        }
      }
    }
    res.json({ ok: true })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.post("/api/jobs/transcribe", async (req, res) => {
  try {
    const body = assertJobSubmit(req.body)
    const job = await transcribe(body.filename, body.whisperModel, body.lang, body.engine)
    res.type("application/json").send(stringifyStatus(job))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.post("/api/jobs/cut", async (req, res) => {
  try {
    const body = assertCut(req.body)
    const job = await cut(body.filename, body.keepIndices, (req.body as any)?.label)
    res.type("application/json").send(stringifyStatus(job))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

/** 자막 라인 편집 */
app.patch("/api/subtitle/*", async (req, res) => {
  try {
    const filename = decodeURIComponent((req.params as any)[0])
    const b = req.body || {}
    if (Array.isArray(b.edits)) {
      const lines = await editLines(filename, b.edits)
      return res.json({ ok: true, lines: lines.length })
    }
    if (b.action === "split" && typeof b.index === "number") {
      await splitLine(filename, b.index, typeof b.at === "number" ? b.at : undefined)
      return res.json({ ok: true })
    }
    if (b.action === "merge" && typeof b.index === "number") {
      await mergeNext(filename, b.index)
      return res.json({ ok: true })
    }
    if (b.action === "nudge" && typeof b.index === "number") {
      await nudgeLine(filename, b.index, Number(b.deltaStart) || 0, Number(b.deltaEnd) || 0)
      return res.json({ ok: true })
    }
    res.status(400).json({ error: "invalid body" })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

/** VTT 다운로드 */
app.get("/api/vtt/*", async (req, res) => {
  try {
    const filename = decodeURIComponent((req.params as any)[0])
    const vtt = await getVtt(filename)
    res.type("text/vtt").send(vtt)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

/** 배치 transcribe — 미추출 파일 전부 큐에 */
app.post("/api/jobs/transcribe-batch", async (_req, res) => {
  try {
    const pending = await listPendingTranscribe()
    const jobs = []
    for (const f of pending) {
      jobs.push(await transcribe(f))
    }
    res.json({ queued: jobs.length, jobs })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get("/api/pending", async (_req, res) => {
  res.json(await listPendingTranscribe())
})

app.get("/api/subtitle-versions/*", async (req, res) => {
  try {
    const filename = decodeURIComponent((req.params as any)[0])
    res.json(await listSubtitleVersions(filename))
  } catch (e: any) { res.status(400).json({ error: e.message }) }
})

app.post("/api/subtitle-activate/*", async (req, res) => {
  try {
    const filename = decodeURIComponent((req.params as any)[0])
    const tag = req.body?.tag
    if (typeof tag !== "string") return res.status(400).json({ error: "tag required" })
    await activateSubtitleVersion(filename, tag)
    res.json({ ok: true })
  } catch (e: any) { res.status(400).json({ error: e.message }) }
})

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: "not found" })
  // stringifyStatus는 log 필드 제외 (용량 감소)
  const { log, ...rest } = job as any
  res.type("application/json").send(stringifyStatus(rest))
})

app.get("/api/jobs/:id/log", (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: "not found" })
  res.type("text/plain").send((job.log || []).join(""))
})

app.post("/api/jobs/:id/cancel", (req, res) => {
  const ok = cancelJob(req.params.id)
  if (!ok) return res.status(404).json({ error: "not running" })
  res.json({ ok: true })
})

app.get("/api/jobs", (_req, res) => res.json(listJobs()))

app.use(express.static(FRONTEND_DIR))
app.get("*", (_req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")))

const PORT = parseInt(process.env.PORT || "8080")
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[autocut-web] :${PORT}  PROJECTS_ROOT=${PROJECTS_ROOT}`)
})
