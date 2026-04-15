import typia, { tags } from "typia"

export interface JobSubmitRequest {
  filename: string & tags.MinLength<1>
  engine?: "whisper" | "qwen3"
  whisperModel?: "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3"
  lang?: "Korean" | "English" | "Japanese" | "zh"
}

export interface JobStatus {
  id: string
  type: "transcribe" | "cut" | "import"
  filename: string
  status: "queued" | "running" | "done" | "failed"
  progress?: number
  message?: string
  outputs?: string[]
  createdAt: string
  finishedAt?: string
}

export interface CutRequest {
  filename: string & tags.MinLength<1>
  /** 선택된 subtitle 인덱스 (SRT의 순번) */
  keepIndices: number[]
}

export interface SubtitleLine {
  index: number
  start: number
  end: number
  duration: number
  text: string
  kept: boolean
}

export interface SubtitleData {
  filename: string
  lines: SubtitleLine[]
  totalDuration: number
  hasSrt: boolean
  hasMd: boolean
}

export interface FileInfo {
  name: string
  size: number
  hasSubtitle: boolean
  hasOutput: boolean
  type: "video" | "audio" | "other"
  outputs?: string[]
  source?: string
  createdAt?: string
  remote?: boolean
  remotePath?: string
}

export interface AppConfig {
  workdir: string
}
export const assertConfig = typia.createAssert<AppConfig>()
export const stringifyConfig = typia.json.createStringify<AppConfig>()

export interface FileListResponse {
  input: FileInfo[]
  output: FileInfo[]
}

export interface SynologyEntry {
  name: string
  path: string
  type: "file" | "dir"
  size?: number
}

export interface SynologyListing {
  path: string
  parent: string | null
  entries: SynologyEntry[]
}

export interface ImportRequest {
  /** /mnt/video 기준 상대 경로 */
  path: string & tags.MinLength<1>
}

export const assertJobSubmit = typia.createAssert<JobSubmitRequest>()
export const assertCut = typia.createAssert<CutRequest>()
export const assertImport = typia.createAssert<ImportRequest>()
export const stringifyStatus = typia.json.createStringify<JobStatus>()
export const stringifyFiles = typia.json.createStringify<FileListResponse>()
export const stringifySubtitle = typia.json.createStringify<SubtitleData>()
export const stringifySynology = typia.json.createStringify<SynologyListing>()
