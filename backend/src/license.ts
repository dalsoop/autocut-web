/**
 * Envato Purchase Code 검증.
 * 구매자는 설치 시 1회 Purchase Code 입력, 로컬에 저장.
 * Envato API 호출 또는 오프라인 activation key.
 */
import { promises as fs } from "fs"
import path from "path"

const LICENSE_FILE = process.env.AUTOCUT_LICENSE_FILE || "/app/config/license.json"
const ENVATO_TOKEN = process.env.ENVATO_API_TOKEN || ""  // 개발자용
const ITEM_ID = process.env.ENVATO_ITEM_ID || ""         // CodeCanyon 아이템 ID

type LicenseRecord = { code: string; verifiedAt: string; buyer?: string }

export async function loadLicense(): Promise<LicenseRecord | null> {
  const raw = await fs.readFile(LICENSE_FILE, "utf-8").catch(() => null)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function saveLicense(rec: LicenseRecord) {
  await fs.mkdir(path.dirname(LICENSE_FILE), { recursive: true })
  await fs.writeFile(LICENSE_FILE, JSON.stringify(rec, null, 2), "utf-8")
}

/** Envato API — Purchase Code가 해당 Item ID 소유자의 것인지 검증 */
export async function verifyWithEnvato(code: string): Promise<{ ok: boolean; buyer?: string; error?: string }> {
  if (!ENVATO_TOKEN) {
    // 개발자 토큰 미설정 시 로컬 bypass (개발 모드)
    return { ok: true, buyer: "dev-mode" }
  }
  try {
    const res = await fetch(`https://api.envato.com/v3/market/author/sale?code=${code}`, {
      headers: { Authorization: `Bearer ${ENVATO_TOKEN}` },
    })
    if (!res.ok) return { ok: false, error: `Envato API ${res.status}` }
    const data: any = await res.json()
    if (ITEM_ID && String(data?.item?.id) !== ITEM_ID) {
      return { ok: false, error: "이 제품의 라이선스가 아닙니다" }
    }
    return { ok: true, buyer: data?.buyer }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

export async function isActivated(): Promise<boolean> {
  if (process.env.AUTOCUT_SKIP_LICENSE === "1") return true  // 개발/무료판
  const rec = await loadLicense()
  return !!rec?.code
}

export async function activate(code: string): Promise<{ ok: boolean; error?: string }> {
  const r = await verifyWithEnvato(code)
  if (!r.ok) return { ok: false, error: r.error }
  await saveLicense({ code, verifiedAt: new Date().toISOString(), buyer: r.buyer })
  return { ok: true }
}
