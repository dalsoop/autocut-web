import { spawn } from "child_process"
import { randomUUID } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import type { JobStatus, FileInfo, SubtitleData, SubtitleLine } from "./types.js"

const AUTOCUT_BIN = process.env.AUTOCUT_BIN || "/opt/autocut/venv/bin/autocut"
const SYNOLOGY_DIR = process.env.AUTOCUT_SYNOLOGY || "/mnt/video"
const PROJECTS_ROOT = path.join(SYNOLOGY_DIR, "10_진행중")
const CONFIG_FILE = process.env.AUTOCUT_CONFIG || "/opt/autocut/autocut-web-config.json"

export { SYNOLOGY_DIR, PROJECTS_ROOT }

type AppConfig = { activeProject: string }

export async function loadConfig(): Promise<AppConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf-8").catch(() => null)
  if (!raw) return { activeProject: "" }
  try { return JSON.parse(raw) } catch { return { activeProject: "" } }
}
export async function saveConfig(cfg: AppConfig) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8")
}

export async function listProjects(): Promise<string[]> {
  const names = await fs.readdir(PROJECTS_ROOT).catch(() => [])
  const out: string[] = []
  for (const n of names) {
    if (n.startsWith(".") || n === "@eaDir" || n === "#recycle") continue
    const st = await fs.stat(path.join(PROJECTS_ROOT, n)).catch(() => null)
    if (st?.isDirectory()) out.push(n)
  }
  return out.sort()
}

async function getProjectDir(): Promise<string> {
  const cfg = await loadConfig()
  if (!cfg.activeProject) throw new Error("활성 프로젝트 미설정")
  return path.join(PROJECTS_ROOT, cfg.activeProject)
}

const jobs = new Map<string, JobStatus>()
export function getJob(id: string) { return jobs.get(id) }
export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function makeJob(type: JobStatus["type"], filename: string): JobStatus {
  const job: JobStatus = {
    id: randomUUID(), type, filename,
    status: "queued", createdAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)
  return job
}

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v)$/i
const AUDIO_EXT = /\.(mp3|wav|m4a|flac|ogg)$/i

function fileType(name: string): FileInfo["type"] {
  if (VIDEO_EXT.test(name)) return "video"
  if (AUDIO_EXT.test(name)) return "audio"
  return "other"
}

async function walkVideos(root: string, rel = ""): Promise<FileInfo[]> {
  const full = path.join(root, rel)
  const names = await fs.readdir(full).catch(() => [])
  const out: FileInfo[] = []
  for (const n of names) {
    if (n.startsWith(".") || n === "@eaDir" || n === "#recycle") continue
    const relPath = rel ? `${rel}/${n}` : n
    const abs = path.join(root, relPath)
    const st = await fs.stat(abs).catch(() => null)
    if (!st) continue
    if (st.isDirectory()) {
      out.push(...await walkVideos(root, relPath))
      continue
    }
    const type = fileType(n)
    if (type === "other") continue
    // 컷 결과물은 source 메타로 분류
    const base = n.replace(/\.[^.]+$/, "")
    const srtPath = path.join(path.dirname(abs), `${base}.srt`)
    const hasSubtitle = await fs.access(srtPath).then(() => true).catch(() => false)
    // 이 비디오의 cut 결과들 찾기
    const dir = path.dirname(abs)
    const sibNames = await fs.readdir(dir).catch(() => [])
    const outputs = sibNames.filter(s =>
      !s.endsWith(".json") && (s === `${base}_cut.mp4` || s.startsWith(`${base}_cut_`))
    ).sort().map(s => (rel ? `${rel}/${s}` : s))
    out.push({
      name: relPath, size: st.size, type,
      hasSubtitle, hasOutput: outputs.length > 0, outputs,
    })
  }
  return out
}

export async function listFiles() {
  const cfg = await loadConfig()
  if (!cfg.activeProject) return { input: [], output: [] }
  const root = path.join(PROJECTS_ROOT, cfg.activeProject)
  // 원본: *_cut* 아닌 것. 결과물: *_cut*.
  const all = await walkVideos(root)
  const input: FileInfo[] = []
  const output: FileInfo[] = []
  for (const f of all) {
    const base = path.basename(f.name).replace(/\.[^.]+$/, "")
    if (base.includes("_cut")) {
      // output 메타
      const metaPath = path.join(root, f.name + ".json")
      const meta = await fs.readFile(metaPath, "utf-8").then(s => JSON.parse(s)).catch(() => null)
      output.push({ ...f, source: meta?.source, createdAt: meta?.createdAt })
    } else {
      input.push(f)
    }
  }
  return { input, output }
}

async function resolveInput(relPath: string): Promise<string> {
  const root = await getProjectDir()
  const norm = path.normalize(relPath)
  if (norm.startsWith("..")) throw new Error("invalid path")
  return path.join(root, norm)
}

export async function transcribe(filename: string, whisperModel = "tiny", lang = "Korean", engine: "whisper" | "qwen3" = "whisper") {
  const filepath = await resolveInput(filename)
  await fs.access(filepath).catch(() => { throw new Error(`not found: ${filename}`) })

  const job = makeJob("transcribe", filename)
  job.status = "running"
  job.progress = 0

  const p = engine === "qwen3"
    ? spawn("/opt/autocut/venv/bin/python", [
        "/opt/autocut/qwen3-transcribe.py", filepath,
        "--lang", lang, "--device", "cuda:0",
      ], { cwd: path.dirname(filepath), env: { ...process.env, HF_HOME: "/opt/autocut/models" } })
    : spawn(AUTOCUT_BIN, [
        "-t", filepath,
        "--whisper-model", whisperModel,
        "--lang", lang,
        "--device", "cpu",
      ], { cwd: path.dirname(filepath) })

  const handle = (d: any) => {
    const line = String(d)
    if (engine === "qwen3") {
      if (line.includes("loading")) job.progress = 10
      if (line.includes("loaded")) job.progress = 40
      if (line.includes("transcribing")) job.progress = 60
      if (line.includes("SRT written")) job.progress = 100
    } else {
      if (line.includes("Init model")) job.progress = 10
      if (line.includes("voice activity")) job.progress = 20
      if (line.includes("Transcribing")) job.progress = 30
      const m = line.match(/(\d+)%\|/)
      if (m) job.progress = 30 + Math.round(parseInt(m[1]) * 0.65)
      if (line.includes("Transcribed")) job.progress = 100
    }
    job.message = line.trim().slice(-200)
  }
  p.stdout.on("data", handle)
  p.stderr.on("data", handle)
  p.on("close", async (code) => {
    job.finishedAt = new Date().toISOString()
    if (code === 0) {
      job.status = "done"
      job.progress = 100
      const base = filepath.replace(/\.[^.]+$/, "")
      job.outputs = []
      for (const ext of [".srt", ".md"]) {
        if (await fs.access(base + ext).then(() => true).catch(() => false)) {
          job.outputs.push(path.basename(base + ext))
        }
      }
    } else {
      job.status = "failed"
      job.message = `exit ${code}: ${job.message}`
    }
  })
  return job
}

async function parseSrt(srtPath: string): Promise<SubtitleLine[]> {
  const raw = await fs.readFile(srtPath, "utf-8").catch(() => "")
  const lines: SubtitleLine[] = []
  const blocks = raw.split(/\n\n+/).filter((b) => b.trim())
  for (const block of blocks) {
    const ln = block.split("\n").filter(Boolean)
    if (ln.length < 3) continue
    const idx = parseInt(ln[0])
    if (isNaN(idx)) continue
    const m = ln[1].match(/(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)/)
    if (!m) continue
    const toSec = (h: string, mm: string, s: string, ms: string) =>
      parseInt(h) * 3600 + parseInt(mm) * 60 + parseInt(s) + parseInt(ms) / 1000
    const start = toSec(m[1], m[2], m[3], m[4])
    const end = toSec(m[5], m[6], m[7], m[8])
    lines.push({
      index: idx, start, end,
      duration: +(end - start).toFixed(2),
      text: ln.slice(2).join(" ").trim(),
      kept: true,
    })
  }
  return lines
}

async function parseMd(mdPath: string): Promise<Set<number>> {
  const raw = await fs.readFile(mdPath, "utf-8").catch(() => "")
  const kept = new Set<number>()
  for (const line of raw.split("\n")) {
    const m = line.match(/^\- \[x\] \[(\d+),/i) || line.match(/^\[(\d+),/)
    if (m) kept.add(parseInt(m[1]))
  }
  return kept
}

export async function getSubtitle(filename: string): Promise<SubtitleData> {
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const srtPath = base + ".srt"
  const mdPath = base + ".md"
  const hasSrt = await fs.access(srtPath).then(() => true).catch(() => false)
  const hasMd = await fs.access(mdPath).then(() => true).catch(() => false)

  if (!hasSrt) return { filename, lines: [], totalDuration: 0, hasSrt: false, hasMd: false }

  const lines = await parseSrt(srtPath)
  if (hasMd) {
    const kept = await parseMd(mdPath)
    if (kept.size > 0) for (const l of lines) l.kept = kept.has(l.index)
  }
  const total = lines.reduce((s, l) => s + l.duration, 0)
  return { filename, lines, totalDuration: +total.toFixed(2), hasSrt, hasMd }
}

export async function cut(filename: string, keepIndices: number[]) {
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const srtPath = base + ".srt"
  const mdPath = base + ".md"
  const dir = path.dirname(filepath)
  const fileBase = path.basename(base)

  const lines = await parseSrt(srtPath)
  const keepSet = new Set(keepIndices)
  const mdHeader = `- [x] <-- Mark if you are done editing.\n\n<video controls="true" allowfullscreen="true"> <source src="${path.basename(filepath)}" type="video/mp4"> </video>\n\nTexts generated from [${fileBase}.srt](${fileBase}.srt).Mark the sentences to keep for autocut.\nThe format is [subtitle_index,duration_in_second] subtitle context.\n\n`
  const mdBody = lines.map((l) => {
    const sec = Math.floor(l.start)
    const mm = String(Math.floor(sec / 60)).padStart(2, "0")
    const ss = String(sec % 60).padStart(2, "0")
    const tag = `[${l.index},${mm}:${ss}]`.padEnd(11, " ")
    const mark = keepSet.has(l.index) ? "x" : " "
    return `- [${mark}] ${tag} ${l.text}`
  }).join("\n")
  await fs.writeFile(mdPath, mdHeader + mdBody, "utf-8")

  const job = makeJob("cut", filename)
  job.status = "running"
  job.progress = 0

  const p = spawn(AUTOCUT_BIN, ["-c", filepath, srtPath, mdPath], { cwd: dir })
  p.stderr.on("data", (d) => {
    const line = String(d)
    const m = line.match(/(\d+)%/)
    if (m) job.progress = parseInt(m[1])
    job.message = line.trim().slice(-200)
  })
  p.on("close", async (code) => {
    job.finishedAt = new Date().toISOString()
    if (code === 0) {
      const srcCut = path.join(dir, `${fileBase}_cut.mp4`)
      const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)
      const dstName = `${fileBase}_cut_${ts}.mp4`
      const dst = path.join(dir, dstName)
      await fs.rename(srcCut, dst).catch(() => {})
      await fs.writeFile(
        dst + ".json",
        JSON.stringify({ source: filename, keepIndices, createdAt: job.finishedAt }, null, 2)
      ).catch(() => {})
      const relDir = path.relative(path.join(PROJECTS_ROOT, (await loadConfig()).activeProject), dir)
      const relDst = relDir ? `${relDir}/${dstName}` : dstName
      job.status = "done"
      job.progress = 100
      job.outputs = [relDst]
    } else {
      job.status = "failed"
      job.message = `exit ${code}: ${job.message}`
    }
  })
  return job
}

/** Synology 브라우저 (10_진행중 하위만) */
export async function listSynology(subpath: string) {
  const norm = path.normalize(subpath).replace(/^\/+/, "")
  if (norm.startsWith("..")) throw new Error("invalid path")
  const full = norm ? path.join(PROJECTS_ROOT, norm) : PROJECTS_ROOT
  const stat = await fs.stat(full).catch(() => null)
  if (!stat) throw new Error("not found")

  const names = await fs.readdir(full)
  const entries = []
  for (const n of names) {
    if (n.startsWith(".") || n === "@eaDir" || n === "#recycle") continue
    const st = await fs.stat(path.join(full, n)).catch(() => null)
    if (!st) continue
    if (st.isFile()) {
      const low = n.toLowerCase()
      if (!VIDEO_EXT.test(low) && !AUDIO_EXT.test(low)) continue
    }
    entries.push({
      name: n,
      path: norm ? `${norm}/${n}` : n,
      type: st.isDirectory() ? "dir" as const : "file" as const,
      size: st.isFile() ? st.size : undefined,
    })
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1
    return a.name.localeCompare(b.name, "ko")
  })
  return { path: norm, parent: norm ? (path.dirname(norm) === "." ? "" : path.dirname(norm)) : null, entries }
}

export async function importFromSynology(_relPath: string): Promise<JobStatus> {
  // 더 이상 import 필요 없음 (Synology = 작업 공간 자체)
  throw new Error("import 불필요: 파일은 이미 Synology 프로젝트 폴더에 있습니다")
}

export async function resolveAbsolute(relPath: string): Promise<string> {
  const cfg = await loadConfig()
  if (!cfg.activeProject) throw new Error("활성 프로젝트 미설정")
  return path.join(PROJECTS_ROOT, cfg.activeProject, relPath)
}
