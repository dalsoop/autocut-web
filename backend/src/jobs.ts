import { spawn } from "child_process"
import { randomUUID } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import type { JobStatus, FileInfo, SubtitleData, SubtitleLine } from "./types.js"

// 모든 경로는 환경변수로 override 가능 (Envato 배포용)
const AUTOCUT_BIN = process.env.AUTOCUT_BIN || "/opt/autocut/venv/bin/autocut"
const QWEN3_SCRIPT = process.env.QWEN3_SCRIPT || "/opt/autocut/qwen3-transcribe.py"
const QWEN3_PYTHON = process.env.QWEN3_PYTHON || "/opt/autocut/venv/bin/python"
const HF_HOME = process.env.HF_HOME || "/opt/autocut/models"
const WORKSPACE_ROOT = process.env.AUTOCUT_WORKSPACE || process.env.AUTOCUT_SYNOLOGY || "/mnt/video"
const PROJECTS_SUBDIR = process.env.AUTOCUT_PROJECTS_SUBDIR || "10_진행중"
const PROJECTS_ROOT = path.join(WORKSPACE_ROOT, PROJECTS_SUBDIR)
const SYNOLOGY_DIR = WORKSPACE_ROOT  // legacy alias
const CONFIG_FILE = process.env.AUTOCUT_CONFIG || "/opt/autocut/autocut-web-config.json"

export { SYNOLOGY_DIR, PROJECTS_ROOT, WORKSPACE_ROOT }

export type AppConfig = {
  activeProject: string
  defaultEngine: "whisper" | "qwen3"
  defaultLang: "Korean" | "English" | "Japanese" | "zh"
  defaultWhisperModel: string
  qwen3Device: string
}

const DEFAULT_CONFIG: AppConfig = {
  activeProject: "",
  defaultEngine: "qwen3",
  defaultLang: "Korean",
  defaultWhisperModel: "medium",
  qwen3Device: "cuda:0",
}

export async function loadConfig(): Promise<AppConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf-8").catch(() => null)
  if (!raw) return { ...DEFAULT_CONFIG }
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } }
  catch { return { ...DEFAULT_CONFIG } }
}
export async function saveConfig(cfg: Partial<AppConfig>) {
  const cur = await loadConfig()
  const merged = { ...cur, ...cfg }
  await fs.writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8")
}

/** 현재 프로젝트에서 자막 없는 파일 리스트 (배치 transcribe 대상) */
export async function listPendingTranscribe(): Promise<string[]> {
  const cfg = await loadConfig()
  if (!cfg.activeProject) return []
  const root = path.join(PROJECTS_ROOT, cfg.activeProject)
  const all = await walkVideos(root)
  return all
    .filter(f => !f.hasSubtitle && !path.basename(f.name).replace(/\.[^.]+$/, "").includes("_cut"))
    .map(f => f.name)
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
const jobProcesses = new Map<string, import("child_process").ChildProcess>()
// Transcribe 순차 처리 (GPU OOM 방지)
let transcribeQueue: Promise<void> = Promise.resolve()
// Cut도 직렬 (ffmpeg 여러 개 동시 IO/CPU 과부하 방지)
let cutQueue: Promise<void> = Promise.resolve()
export function getJob(id: string) { return jobs.get(id) }
export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export function cancelJob(id: string): boolean {
  const p = jobProcesses.get(id)
  if (!p) return false
  p.kill("SIGTERM")
  const job = jobs.get(id)
  if (job) { job.status = "failed"; job.message = "취소됨"; job.finishedAt = new Date().toISOString() }
  jobProcesses.delete(id)
  return true
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

/** 프로젝트 CRUD */
export async function createProject(name: string): Promise<void> {
  if (!/^[\w가-힣][\w가-힣_\- ]*$/.test(name)) throw new Error("프로젝트 이름 형식 오류")
  await fs.mkdir(path.join(PROJECTS_ROOT, name), { recursive: true })
}

export async function renameProject(oldName: string, newName: string): Promise<void> {
  if (!/^[\w가-힣][\w가-힣_\- ]*$/.test(newName)) throw new Error("이름 형식 오류")
  await fs.rename(path.join(PROJECTS_ROOT, oldName), path.join(PROJECTS_ROOT, newName))
  const cfg = await loadConfig()
  if (cfg.activeProject === oldName) await saveConfig({ activeProject: newName })
}

export async function archiveProject(name: string): Promise<void> {
  // 40_아카이브/완료프로젝트/ 로 mv (같은 volume 가정 → instant)
  const archiveDir = path.join(WORKSPACE_ROOT, "40_아카이브", "완료프로젝트")
  await fs.mkdir(archiveDir, { recursive: true })
  await fs.rename(path.join(PROJECTS_ROOT, name), path.join(archiveDir, name))
  const cfg = await loadConfig()
  if (cfg.activeProject === name) await saveConfig({ activeProject: "" })
}

/** 파일 조작 */
export async function renameFile(relPath: string, newName: string): Promise<void> {
  if (newName.includes("/") || newName.includes("..")) throw new Error("invalid name")
  const abs = await resolveInput(relPath)
  const dir = path.dirname(abs)
  const oldBase = abs.replace(/\.[^.]+$/, "")
  const ext = path.extname(abs)
  const newBase = path.join(dir, newName.replace(/\.[^.]+$/, ""))
  const newAbs = newBase + ext
  await fs.rename(abs, newAbs)
  // 자막/메타/버전폴더/output json도 함께
  for (const sfx of [".srt", ".md", ".srt.meta.json", ".vtt", ".json"]) {
    await fs.rename(oldBase + sfx, newBase + sfx).catch(() => {})
  }
  await fs.rename(oldBase + "_subs", newBase + "_subs").catch(() => {})
}

/** 트리 구조 (디렉토리별 그룹핑) */
export async function listTree(): Promise<any> {
  const cfg = await loadConfig()
  if (!cfg.activeProject) return { name: "", path: "", type: "dir", children: [] }
  const root = path.join(PROJECTS_ROOT, cfg.activeProject)
  async function walk(abs: string, rel: string): Promise<any> {
    const st = await fs.stat(abs).catch(() => null)
    if (!st) return null
    if (st.isDirectory()) {
      const names = await fs.readdir(abs).catch(() => [])
      const children = []
      for (const n of names) {
        if (n.startsWith(".") || n === "@eaDir" || n === "#recycle" || n.endsWith("_subs") ||
            n.endsWith(".srt") || n.endsWith(".md") || n.endsWith(".json") || n.endsWith(".vtt")) continue
        const child = await walk(path.join(abs, n), rel ? `${rel}/${n}` : n)
        if (child) children.push(child)
      }
      children.sort((a: any, b: any) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1
        return a.name.localeCompare(b.name, "ko")
      })
      return { name: path.basename(abs), path: rel, type: "dir", children }
    }
    // 파일
    const low = abs.toLowerCase()
    if (!VIDEO_EXT.test(low) && !AUDIO_EXT.test(low)) return null
    const base = abs.replace(/\.[^.]+$/, "")
    const hasSubtitle = await fs.access(base + ".srt").then(() => true).catch(() => false)
    const dir = path.dirname(abs)
    const fileBase = path.basename(base)
    const sibs = await fs.readdir(dir).catch(() => [])
    const outputs = sibs.filter(s =>
      !s.endsWith(".json") && (s === `${fileBase}_cut.mp4` || s.startsWith(`${fileBase}_cut_`))
    )
    return {
      name: path.basename(abs), path: rel, type: "file",
      size: st.size,
      file: {
        name: rel, size: st.size, type: "video",
        hasSubtitle, hasOutput: outputs.length > 0, outputs,
      },
    }
  }
  return await walk(root, "")
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
      output.push({
        ...f,
        source: meta?.source,
        createdAt: meta?.createdAt,
        engine: meta?.transcribe?.engine,
        lang: meta?.transcribe?.lang,
        whisperModel: meta?.transcribe?.whisperModel,
        keptCount: meta?.keptCount,
        totalCount: meta?.totalCount,
      } as any)
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

export async function transcribe(filename: string, whisperModel?: string, lang?: string, engine?: "whisper" | "qwen3") {
  // 큐에 등록: job은 즉시 반환(queued), 실제 spawn은 직렬
  const job = makeJob("transcribe", filename)
  job.status = "queued"
  job.progress = 0
  transcribeQueue = transcribeQueue.then(() =>
    runTranscribe(job, filename, whisperModel, lang, engine).catch(e => {
      job.status = "failed"
      job.message = String(e?.message || e)
      job.finishedAt = new Date().toISOString()
    })
  )
  return job
}

async function runTranscribe(
  job: JobStatus, filename: string,
  whisperModel?: string, lang?: string, engine?: "whisper" | "qwen3"
): Promise<void> {
  const cfg = await loadConfig()
  engine = engine || cfg.defaultEngine
  lang = lang || cfg.defaultLang
  whisperModel = whisperModel || cfg.defaultWhisperModel

  // 재추출 시 기존 SRT/MD를 버전 폴더로 archive
  const filepath2 = await resolveInput(filename)
  const base2 = filepath2.replace(/\.[^.]+$/, "")
  const versionsDir = base2 + "_subs"
  const existing = await fs.access(base2 + ".srt").then(() => true).catch(() => false)
  if (existing) {
    await fs.mkdir(versionsDir, { recursive: true })
    const prevMeta = await fs.readFile(base2 + ".srt.meta.json", "utf-8")
      .then(s => JSON.parse(s)).catch(() => null)
    const prevEngine = prevMeta?.engine || "unknown"
    const prevTs = (prevMeta?.createdAt || new Date().toISOString()).replace(/[-:T]/g, "").slice(0, 15)
    const tag = `${prevTs}_${prevEngine}` + (prevMeta?.whisperModel ? `_${prevMeta.whisperModel}` : "")
    for (const ext of [".srt", ".md", ".srt.meta.json"]) {
      if (await fs.access(base2 + ext).then(() => true).catch(() => false)) {
        await fs.rename(base2 + ext, path.join(versionsDir, `${tag}${ext}`)).catch(() => {})
      }
    }
  }
  const filepath = await resolveInput(filename)
  await fs.access(filepath).catch(() => { throw new Error(`not found: ${filename}`) })

  job.status = "running"
  job.progress = 0
  const _jobId = job.id

  const p = engine === "qwen3"
    ? spawn(QWEN3_PYTHON, [
        QWEN3_SCRIPT, filepath,
        "--lang", lang, "--device", cfg.qwen3Device,
      ], { cwd: path.dirname(filepath), env: { ...process.env, HF_HOME } })
    : spawn(AUTOCUT_BIN, [
        "-t", filepath,
        "--whisper-model", whisperModel,
        "--lang", lang,
        "--device", "cpu",
      ], { cwd: path.dirname(filepath) })
  jobProcesses.set(_jobId, p)

  job.log = []
  const handle = (d: any) => {
    const line = String(d)
    job.log!.push(line)
    if (job.log!.length > 500) job.log!.shift()
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
  await new Promise<void>((resolve) => {
    p.on("close", async (code) => {
      jobProcesses.delete(_jobId)
      if (job.status === "failed") { resolve(); return }
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
        const meta = {
          engine, lang,
          whisperModel: engine === "whisper" ? whisperModel : undefined,
          qwen3Device: engine === "qwen3" ? cfg.qwen3Device : undefined,
          createdAt: job.finishedAt,
        }
        await fs.writeFile(base + ".srt.meta.json",
          JSON.stringify(meta, null, 2), "utf-8").catch(() => {})
      } else {
        job.status = "failed"
        job.message = `exit ${code}: ${job.message}`
      }
      resolve()
    })
  })
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

function fmtSrtTs(sec: number): string {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const mss = ms % 1000
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(mss).padStart(3,"0")}`
}

export async function writeSrt(srtPath: string, lines: SubtitleLine[]) {
  const out = lines.map((l, i) =>
    `${i+1}\n${fmtSrtTs(l.start)} --> ${fmtSrtTs(l.end)}\n${l.text.trim()}\n`
  ).join("\n")
  await fs.writeFile(srtPath, out, "utf-8")
}

async function loadWithKept(base: string): Promise<SubtitleLine[]> {
  const lines = await parseSrt(base + ".srt")
  const mdPath = base + ".md"
  if (await fs.access(mdPath).then(() => true).catch(() => false)) {
    const kept = await parseMd(mdPath)
    if (kept.size > 0) for (const l of lines) l.kept = kept.has(l.index)
  }
  return lines
}

/** MD 재작성 — 현재 kept 상태 보존 */
async function writeMd(base: string, videoName: string, lines: SubtitleLine[]) {
  const mdPath = base + ".md"
  const fileBase = path.basename(base)
  const header = `- [x] <-- Mark if you are done editing.\n\n<video controls="true" allowfullscreen="true"> <source src="${videoName}" type="video/mp4"> </video>\n\nTexts generated from [${fileBase}.srt](${fileBase}.srt).\nThe format is [subtitle_index,duration_in_second] subtitle context.\n\n`
  const body = lines.map(l => {
    const sec = Math.floor(l.start)
    const mm = String(Math.floor(sec / 60)).padStart(2, "0")
    const ss = String(sec % 60).padStart(2, "0")
    const tag = `[${l.index},${mm}:${ss}]`.padEnd(11, " ")
    return `- [${l.kept ? "x" : " "}] ${tag} ${l.text}`
  }).join("\n")
  await fs.writeFile(mdPath, header + body, "utf-8")
}

/** 자막 라인 편집 (텍스트 변경) — kept 상태 보존 */
export async function editLines(filename: string, edits: { index: number; text: string; kept?: boolean }[]) {
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const lines = await loadWithKept(base)
  const byIdx = new Map(lines.map(l => [l.index, l]))
  for (const e of edits) {
    const l = byIdx.get(e.index)
    if (l) {
      l.text = e.text
      if (typeof e.kept === "boolean") l.kept = e.kept
    }
  }
  await writeSrt(base + ".srt", lines)
  await writeMd(base, path.basename(filepath), lines)
  return lines
}

/** 타임스탬프 nudge (start/end 조정) */
export async function nudgeLine(filename: string, index: number, deltaStart: number, deltaEnd: number) {
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const lines = await loadWithKept(base)
  const l = lines.find(x => x.index === index)
  if (!l) throw new Error("line not found")
  l.start = Math.max(0, l.start + deltaStart)
  l.end = Math.max(l.start + 0.05, l.end + deltaEnd)
  l.duration = +(l.end - l.start).toFixed(2)
  await writeSrt(base + ".srt", lines)
  await writeMd(base, path.basename(filepath), lines)
  return lines
}

/** 라인 split — kept 상속 */
export async function splitLine(filename: string, index: number, splitAtSec?: number) {
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const lines = await loadWithKept(base)
  const i = lines.findIndex(l => l.index === index)
  if (i < 0) throw new Error("line not found")
  const l = lines[i]
  const mid = splitAtSec ?? (l.start + l.end) / 2
  const halfLen = Math.floor(l.text.length / 2)
  const first = { ...l, end: mid, text: l.text.slice(0, halfLen).trim(), duration: +(mid - l.start).toFixed(2) }
  const second = {
    ...l, index: 0, start: mid,
    text: l.text.slice(halfLen).trim(),
    duration: +(l.end - mid).toFixed(2),
    kept: l.kept,
  }
  lines.splice(i, 1, first, second)
  lines.forEach((x, k) => x.index = k + 1)
  await writeSrt(base + ".srt", lines)
  await writeMd(base, path.basename(filepath), lines)
  return lines
}

/** 라인 merge — kept OR */
export async function mergeNext(filename: string, index: number) {
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const lines = await loadWithKept(base)
  const i = lines.findIndex(l => l.index === index)
  if (i < 0 || i + 1 >= lines.length) throw new Error("merge 불가")
  const merged = {
    ...lines[i],
    end: lines[i+1].end,
    text: (lines[i].text + " " + lines[i+1].text).trim(),
    duration: +(lines[i+1].end - lines[i].start).toFixed(2),
    kept: lines[i].kept || lines[i+1].kept,
  }
  lines.splice(i, 2, merged)
  lines.forEach((x, k) => x.index = k + 1)
  await writeSrt(base + ".srt", lines)
  await writeMd(base, path.basename(filepath), lines)
  return lines
}

/** 자막 버전 목록 */
export async function listSubtitleVersions(filename: string) {
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const versionsDir = base + "_subs"
  const entries = []
  const currentMeta = await fs.readFile(base + ".srt.meta.json", "utf-8")
    .then(s => JSON.parse(s)).catch(() => null)
  if (await fs.access(base + ".srt").then(() => true).catch(() => false)) {
    entries.push({
      tag: "current",
      engine: currentMeta?.engine || "unknown",
      whisperModel: currentMeta?.whisperModel,
      lang: currentMeta?.lang,
      createdAt: currentMeta?.createdAt,
      active: true,
    })
  }
  const names = await fs.readdir(versionsDir).catch(() => [])
  for (const n of names) {
    if (!n.endsWith(".srt")) continue
    const tag = n.replace(/\.srt$/, "")
    const metaPath = path.join(versionsDir, `${tag}.srt.meta.json`)
    const meta = await fs.readFile(metaPath, "utf-8")
      .then(s => JSON.parse(s)).catch(() => null)
    entries.push({
      tag,
      engine: meta?.engine,
      whisperModel: meta?.whisperModel,
      lang: meta?.lang,
      createdAt: meta?.createdAt,
      active: false,
    })
  }
  return entries
}

/** 특정 버전을 current로 복원 */
export async function activateSubtitleVersion(filename: string, tag: string) {
  if (tag === "current") return
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const versionsDir = base + "_subs"
  // 현재 → 버전 폴더로 archive (tag 다시 생성)
  const curMeta = await fs.readFile(base + ".srt.meta.json", "utf-8")
    .then(s => JSON.parse(s)).catch(() => null)
  if (curMeta) {
    await fs.mkdir(versionsDir, { recursive: true })
    const curTs = (curMeta.createdAt || new Date().toISOString()).replace(/[-:T]/g, "").slice(0,15)
    const curTag = `${curTs}_${curMeta.engine || "unknown"}` + (curMeta.whisperModel ? `_${curMeta.whisperModel}` : "")
    for (const ext of [".srt", ".md", ".srt.meta.json"]) {
      if (await fs.access(base + ext).then(() => true).catch(() => false)) {
        await fs.rename(base + ext, path.join(versionsDir, `${curTag}${ext}`)).catch(() => {})
      }
    }
  }
  // 선택 버전 → current로 복원
  for (const ext of [".srt", ".md", ".srt.meta.json"]) {
    const src = path.join(versionsDir, `${tag}${ext}`)
    if (await fs.access(src).then(() => true).catch(() => false)) {
      await fs.rename(src, base + ext).catch(() => {})
    }
  }
}

/** VTT 변환 */
export async function getVtt(filename: string): Promise<string> {
  const filepath = await resolveInput(filename)
  const base = filepath.replace(/\.[^.]+$/, "")
  const lines = await parseSrt(base + ".srt")
  const out = ["WEBVTT", ""]
  for (const l of lines) {
    out.push(`${fmtSrtTs(l.start).replace(",", ".")} --> ${fmtSrtTs(l.end).replace(",", ".")}`)
    out.push(l.text)
    out.push("")
  }
  return out.join("\n")
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
  const meta = await fs.readFile(base + ".srt.meta.json", "utf-8")
    .then(s => JSON.parse(s)).catch(() => null)
  return {
    filename, lines, totalDuration: +total.toFixed(2), hasSrt, hasMd,
    engine: meta?.engine, whisperModel: meta?.whisperModel,
    lang: meta?.lang, createdAt: meta?.createdAt,
  }
}

export async function cut(filename: string, keepIndices: number[], label?: string) {
  const job = makeJob("cut", filename)
  job.status = "queued"
  job.progress = 0
  cutQueue = cutQueue.then(() =>
    runCut(job, filename, keepIndices, label).catch(e => {
      job.status = "failed"
      job.message = String(e?.message || e)
      job.finishedAt = new Date().toISOString()
    })
  )
  return job
}

async function runCut(job: JobStatus, filename: string, keepIndices: number[], label?: string): Promise<void> {
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

  job.status = "running"
  job.progress = 0
  job.log = []

  const p = spawn(AUTOCUT_BIN, ["-c", filepath, srtPath, mdPath], { cwd: dir })
  jobProcesses.set(job.id, p)
  const collect = (d: any) => {
    const s = String(d)
    job.log!.push(s)
    if (job.log!.length > 500) job.log!.shift()
    const m = s.match(/(\d+)%/)
    if (m) job.progress = parseInt(m[1])
    job.message = s.trim().slice(-200)
  }
  p.stdout.on("data", collect)
  p.stderr.on("data", collect)
  await new Promise<void>((resolve) => {
  p.on("close", async (code) => {
    jobProcesses.delete(job.id)
    if (job.status === "failed") return
    job.finishedAt = new Date().toISOString()
    if (code === 0) {
      const srcCut = path.join(dir, `${fileBase}_cut.mp4`)
      const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)
      const safeLabel = label ? "_" + label.replace(/[^\w가-힣-]/g, "_").slice(0, 40) : ""
      const dstName = `${fileBase}_cut_${ts}${safeLabel}.mp4`
      const dst = path.join(dir, dstName)
      await fs.rename(srcCut, dst).catch(() => {})
      // SRT 메타 읽어서 결과에 포함
      const srtMeta = await fs.readFile(base + ".srt.meta.json", "utf-8")
        .then(s => JSON.parse(s)).catch(() => null)
      await fs.writeFile(
        dst + ".json",
        JSON.stringify({
          source: filename,
          keepIndices,
          keptCount: keepIndices.length,
          totalCount: lines.length,
          transcribe: srtMeta || null,  // 어떤 엔진으로 자막 만들었나
          createdAt: job.finishedAt,
        }, null, 2)
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
    resolve()
  })
  })
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
