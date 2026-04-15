import typia, { tags } from "typia"

export interface JobSubmitRequest {
  /** 서버에 업로드된 파일의 basename (예: video.mp4) */
  filename: string & tags.MinLength<1> & tags.MaxLength<255>
  /** Whisper 모델 */
  whisperModel?: "tiny" | "base" | "small" | "medium" | "large-v3-turbo"
  /** 언어 */
  lang?: "ko" | "en" | "ja" | "zh" | "auto"
}

export interface JobStatus {
  id: string
  type: "transcribe" | "cut"
  filename: string
  status: "queued" | "running" | "done" | "failed"
  progress?: number
  message?: string
  outputs?: string[]
  createdAt: string
  finishedAt?: string
}

export interface CutRequest {
  /** 입력 영상 파일명 */
  filename: string & tags.MinLength<1>
  /** 편집된 MD 내용 (원본 자막에서 원치 않는 줄 제거한 상태) */
  mdContent: string & tags.MinLength<1>
}

export interface FileListResponse {
  input: string[]
  output: string[]
}

export const assertJobSubmit = typia.createAssert<JobSubmitRequest>()
export const assertCut = typia.createAssert<CutRequest>()
export const stringifyStatus = typia.json.createStringify<JobStatus>()
export const stringifyFiles = typia.json.createStringify<FileListResponse>()
