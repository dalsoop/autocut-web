import { spawn } from "child_process"
import { randomUUID } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import type { JobStatus, FileInfo, SubtitleData, SubtitleLine } from "./types.js"

const INPUT_DIR = process.env.AUTOCUT_INPUT || "/opt/autocut/input"
const OUTPUT_DIR = process.env.AUTOCUT_OUTPUT || "/opt/autocut/output"
const AUTOCUT_BIN = process.env.AUTOCUT_BIN || "/opt/autocut/venv/bin/autocut"
const SYNOLOGY_DIR = process.env.AUTOCUT_SYNOLOGY || "/mnt/video"

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

export async function listFiles() {
  async function scan(dir: string): Promise<FileInfo[]> {
    const names = await fs.readdir(dir).catch(() => [])
    const result: FileInfo[] = []
    for (const n of names) {
      if (n.startsWith(".")) continue
      const type = fileType(n)
      if (type === "other") continue
      const stat = await fs.stat(path.join(dir, n)).catch(() => null)
      if (!stat) continue
      const base = n.replace(/\.[^.]+$/, "")
      const hasSubtitle = await fs.access(path.join(INPUT_DIR, `${base}.srt`))
        .then(() => true).catch(() => false)
      const hasOutput = await fs.access(path.join(OUTPUT_DIR, `${base}_cut.mp4`))
        .then(() => true).catch(() => false)
      result.push({ name: n, size: stat.size, type, hasSubtitle, hasOutput })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, "ko"))
  }
  return { input: await scan(INPUT_DIR), output: await scan(OUTPUT_DIR) }
}

export async function transcribe(filename: string, whisperModel = "tiny", lang = "Korean") {
  const filepath = path.join(INPUT_DIR, filename)
  await fs.access(filepath).catch(() => { throw new Error(`not found: ${filename}`) })

  const job = makeJob("transcribe", filename)
  job.status = "running"
  job.progress = 0

  const p = spawn(AUTOCUT_BIN, [
    "-t", filepath,
    "--whisper-model", whisperModel,
    "--lang", lang,
    "--device", "cpu",
  ], { cwd: INPUT_DIR })

  p.stdout.on("data", (d) => { job.message = String(d).slice(-200) })
  p.stderr.on("data", (d) => {
    const line = String(d)
    if (line.includes("Init model")) job.progress = 10
    if (line.includes("voice activity")) job.progress = 20
    if (line.includes("Transcribing")) job.progress = 30
    const m = line.match(/(\d+)%\|/)
    if (m) job.progress = 30 + Math.round(parseInt(m[1]) * 0.65)
    if (line.includes("Transcribed")) job.progress = 100
    job.message = line.trim().slice(-200)
  })
  p.on("close", async (code) => {
    job.finishedAt = new Date().toISOString()
    const base = filename.replace(/\.[^.]+$/, "")
    if (code === 0) {
      job.status = "done"
      job.progress = 100
      job.outputs = []
      for (const f of [`${base}.srt`, `${base}.md`]) {
        const exists = await fs.access(path.join(INPUT_DIR, f)).then(() => true).catch(() => false)
        if (exists) job.outputs.push(f)
      }
    } else {
      job.status = "failed"
      job.message = `exit ${code}: ${job.message}`
    }
  })
  return job
}

/** SRT 파싱 */
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

/** MD 파싱 — kept 여부 추출 */
async function parseMd(mdPath: string): Promise<Set<number>> {
  const raw = await fs.readFile(mdPath, "utf-8").catch(() => "")
  const kept = new Set<number>()
  for (const line of raw.split("\n")) {
    // autocut MD: `- [x] <-- Mark` 또는 `[N,...]` 형식
    const m = line.match(/^\[(\d+),/)
    if (m) kept.add(parseInt(m[1]))
  }
  return kept
}

export async function getSubtitle(filename: string): Promise<SubtitleData> {
  const base = filename.replace(/\.[^.]+$/, "")
  const srtPath = path.join(INPUT_DIR, `${base}.srt`)
  const mdPath = path.join(INPUT_DIR, `${base}.md`)
  const hasSrt = await fs.access(srtPath).then(() => true).catch(() => false)
  const hasMd = await fs.access(mdPath).then(() => true).catch(() => false)

  if (!hasSrt) {
    return { filename, lines: [], totalDuration: 0, hasSrt: false, hasMd: false }
  }

  const lines = await parseSrt(srtPath)
  // MD가 있고 일부만 선택된 경우 kept 반영
  if (hasMd) {
    const kept = await parseMd(mdPath)
    if (kept.size > 0) {
      for (const l of lines) l.kept = kept.has(l.index)
    }
  }
  const total = lines.reduce((s, l) => s + l.duration, 0)
  return { filename, lines, totalDuration: +total.toFixed(2), hasSrt, hasMd }
}

export async function cut(filename: string, keepIndices: number[]) {
  const base = filename.replace(/\.[^.]+$/, "")
  const srtPath = path.join(INPUT_DIR, `${base}.srt`)
  const mdPath = path.join(INPUT_DIR, `${base}.md`)
  const filepath = path.join(INPUT_DIR, filename)

  // autocut MD 포맷으로 생성: kept만 [N,duration] 유지
  const lines = await parseSrt(srtPath)
  const keepSet = new Set(keepIndices)
  const mdHeader = `- [x] <-- Mark if you are done editing.\n\n<video controls="true" allowfullscreen="true"> <source src="${filename}" type="video/mp4"> </video>\n\nTexts generated from [${base}.srt](${base}.srt).Mark the sentences to keep for autocut.\nThe format is [subtitle_index,duration_in_second] subtitle context.\n\n`
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

  const p = spawn(AUTOCUT_BIN, ["-c", filepath, srtPath, mdPath], { cwd: INPUT_DIR })
  p.stderr.on("data", (d) => {
    const line = String(d)
    const m = line.match(/(\d+)%/)
    if (m) job.progress = parseInt(m[1])
    job.message = line.trim().slice(-200)
  })
  p.on("close", async (code) => {
    job.finishedAt = new Date().toISOString()
    if (code === 0) {
      const outName = `${base}_cut.mp4`
      const src = path.join(INPUT_DIR, outName)
      const dst = path.join(OUTPUT_DIR, outName)
      await fs.rename(src, dst).catch(() => {})
      job.status = "done"
      job.progress = 100
      job.outputs = [outName]
    } else {
      job.status = "failed"
      job.message = `exit ${code}: ${job.message}`
    }
  })
  return job
}

/** Synology 브라우저 */
export async function listSynology(subpath: string) {
  const norm = path.normalize(subpath).replace(/^\/+/, "")
  if (norm.startsWith("..")) throw new Error("invalid path")
  const full = path.join(SYNOLOGY_DIR, norm)
  const stat = await fs.stat(full).catch(() => null)
  if (!stat) throw new Error("not found")

  if (stat.isFile()) {
    return {
      path: norm,
      parent: path.dirname(norm) === "." ? "" : path.dirname(norm),
      entries: [{
        name: path.basename(norm),
        path: norm,
        type: "file" as const,
        size: stat.size,
      }],
    }
  }

  const names = await fs.readdir(full)
  const entries = []
  for (const n of names) {
    if (n.startsWith(".") || n === "@eaDir") continue
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

  return {
    path: norm,
    parent: norm ? (path.dirname(norm) === "." ? "" : path.dirname(norm)) : null,
    entries,
  }
}

/** Synology → input 복사 */
export async function importFromSynology(relPath: string): Promise<JobStatus> {
  const src = path.join(SYNOLOGY_DIR, relPath)
  const name = path.basename(relPath)
  const dst = path.join(INPUT_DIR, name)
  const stat = await fs.stat(src).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error("not a file")

  const job = makeJob("import", name)
  job.status = "running"
  job.progress = 0

  ;(async () => {
    try {
      await fs.copyFile(src, dst)
      job.status = "done"
      job.progress = 100
    } catch (e: any) {
      job.status = "failed"
      job.message = e.message
    }
    job.finishedAt = new Date().toISOString()
  })()

  return job
}

export { INPUT_DIR, OUTPUT_DIR, SYNOLOGY_DIR }
