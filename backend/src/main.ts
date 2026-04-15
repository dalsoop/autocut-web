import express from "express"
import multer from "multer"
import path from "path"
import { promises as fs } from "fs"
import { fileURLToPath } from "url"

import {
  assertJobSubmit,
  assertCut,
  stringifyStatus,
  stringifyFiles,
} from "./types.js"
import {
  transcribe,
  cut,
  getJob,
  listJobs,
  listFiles,
  INPUT_DIR,
  OUTPUT_DIR,
} from "./jobs.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = path.resolve(__dirname, "../../frontend/public")

const app = express()
app.use(express.json({ limit: "10mb" }))

const upload = multer({
  dest: INPUT_DIR,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
})

// 업로드
app.post("/api/upload", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" })
  const final = path.join(INPUT_DIR, req.file.originalname)
  await fs.rename(req.file.path, final)
  res.json({ filename: req.file.originalname, size: req.file.size })
})

// 파일 목록
app.get("/api/files", async (_req, res) => {
  res.type("application/json").send(stringifyFiles(await listFiles()))
})

// Input SRT/MD 다운로드
app.get("/api/input/:name", async (req, res) => {
  res.sendFile(path.join(INPUT_DIR, req.params.name))
})

// Output 다운로드
app.get("/api/output/:name", async (req, res) => {
  res.sendFile(path.join(OUTPUT_DIR, req.params.name))
})

// 자막 추출 잡 생성
app.post("/api/jobs/transcribe", async (req, res) => {
  try {
    const body = assertJobSubmit(req.body)
    const job = await transcribe(body.filename, body.whisperModel, body.lang)
    res.type("application/json").send(stringifyStatus(job))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// 컷 편집 잡 생성
app.post("/api/jobs/cut", async (req, res) => {
  try {
    const body = assertCut(req.body)
    const job = await cut(body.filename, body.mdContent)
    res.type("application/json").send(stringifyStatus(job))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// 잡 상태
app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: "not found" })
  res.type("application/json").send(stringifyStatus(job))
})

// 전체 잡 목록
app.get("/api/jobs", (_req, res) => {
  res.json(listJobs())
})

// 프론트엔드 정적 서빙
app.use(express.static(FRONTEND_DIR))
app.get("*", (_req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")))

const PORT = parseInt(process.env.PORT || "8080")
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[autocut-web] listening on :${PORT}`)
  console.log(`  INPUT: ${INPUT_DIR}`)
  console.log(`  OUTPUT: ${OUTPUT_DIR}`)
})
