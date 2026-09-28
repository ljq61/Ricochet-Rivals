/**
 * 轻量用户设置（Phase 11）：仅 soundEnabled。
 * - localStorage 可用时跨刷新持久化（try/catch 兜底：隐私模式 / 禁用）
 * - 不可用时（测试环境 / SSR）内存兜底，Scene 切换期间保持
 * 不建数据库、不建账号系统（CODELY.md §22）。
 */

const STORAGE_KEY = 'ricochet-rivals:settings';

export interface UserSettings {
  soundEnabled: boolean;
}

let inMemory: UserSettings = { soundEnabled: true };

function readStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(raw: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, raw);
  } catch {
    // 写入失败（隐私模式 / 容量）→ 只影响持久化，不影响当次会话
  }
}

/** 当前设置快照（Scene 任意时刻可读） */
export function getUserSettings(): UserSettings {
  const raw = readStorage();
  if (raw === null) {
    return { ...inMemory };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return { soundEnabled: parsed.soundEnabled !== false };
  } catch {
    return { ...inMemory };
  }
}

/** 翻转声音开关并持久化；返回翻转后的值 */
export function toggleSound(): boolean {
  const next = !getUserSettings().soundEnabled;
  inMemory = { soundEnabled: next };
  writeStorage(JSON.stringify(inMemory));
  return next;
}

/** 重置为默认（测试用；不清除他人 localStorage 键） */
export function resetUserSettingsForTest(): void {
  inMemory = { soundEnabled: true };
}
