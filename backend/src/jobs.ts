import { spawn } from "child_process"
import { randomUUID } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import type { JobStatus } from "./types.js"

const INPUT_DIR = process.env.AUTOCUT_INPUT || "/opt/autocut/input"
const OUTPUT_DIR = process.env.AUTOCUT_OUTPUT || "/opt/autocut/output"
const AUTOCUT_BIN = process.env.AUTOCUT_BIN || "/opt/autocut/venv/bin/autocut"

const jobs = new Map<string, JobStatus>()

export function getJob(id: string): JobStatus | undefined {
  return jobs.get(id)
}

export function listJobs(): JobStatus[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function makeJob(type: JobStatus["type"], filename: string): JobStatus {
  const job: JobStatus = {
    id: randomUUID(),
    type,
    filename,
    status: "queued",
    createdAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)
  return job
}

export async function transcribe(
  filename: string,
  whisperModel = "tiny",
  lang = "ko"
): Promise<JobStatus> {
  const filepath = path.join(INPUT_DIR, filename)
  await fs.access(filepath).catch(() => {
    throw new Error(`input file not found: ${filename}`)
  })

  const job = makeJob("transcribe", filename)
  job.status = "running"
  job.progress = 0

  const p = spawn(AUTOCUT_BIN, [
    "-t", filepath,
    "--whisper-model", whisperModel,
    "--lang", lang,
    "--device", "cpu",
  ])

  p.stdout.on("data", (d) => { job.message = d.toString().slice(-200) })
  p.stderr.on("data", (d) => {
    const line = d.toString()
    if (line.includes("Transcribing")) job.progress = 20
    if (line.match(/\d+%/)) {
      const pct = parseInt(line.match(/(\d+)%/)![1])
      job.progress = 20 + Math.round(pct * 0.7)
    }
    job.message = line.slice(-200)
  })
  p.on("close", async (code) => {
    job.finishedAt = new Date().toISOString()
    if (code === 0) {
      const srt = filename.replace(/\.[^.]+$/, ".srt")
      const md = filename.replace(/\.[^.]+$/, ".md")
      job.status = "done"
      job.progress = 100
      job.outputs = [srt, md].filter((f) =>
        fs.access(path.join(INPUT_DIR, f)).then(() => true).catch(() => false) as any
      )
    } else {
      job.status = "failed"
      job.message = `exit code ${code}`
    }
  })

  return job
}

export async function cut(filename: string, mdContent: string): Promise<JobStatus> {
  const base = filename.replace(/\.[^.]+$/, "")
  const mdPath = path.join(INPUT_DIR, `${base}.md`)
  const filepath = path.join(INPUT_DIR, filename)

  await fs.writeFile(mdPath, mdContent, "utf-8")

  const job = makeJob("cut", filename)
  job.status = "running"
  job.progress = 0

  const p = spawn(AUTOCUT_BIN, ["-c", filepath])

  p.stderr.on("data", (d) => {
    const line = d.toString()
    job.message = line.slice(-200)
    if (line.match(/(\d+)%/)) job.progress = parseInt(line.match(/(\d+)%/)![1])
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
      job.message = `exit code ${code}`
    }
  })

  return job
}

export async function listFiles() {
  const input = await fs.readdir(INPUT_DIR).catch(() => [])
  const output = await fs.readdir(OUTPUT_DIR).catch(() => [])
  return { input, output }
}

export { INPUT_DIR, OUTPUT_DIR }
