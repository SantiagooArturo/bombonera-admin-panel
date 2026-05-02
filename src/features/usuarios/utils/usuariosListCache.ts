import type { User } from "@/lib/types";

const SCHEMA = 1;
const BROWSE_KEY = "bombonera_usuarios_browse_v1";
const ATTENTION_KEY = "bombonera_usuarios_attention_v1";
const SUMMARY_KEY = "bombonera_usuarios_summary_v1";
const SEARCH_PREFIX = "bombonera_usuarios_search_v1:";

/** Debe coincidir con el `limit` que pide la página al API. */
export const USUARIOS_BROWSE_CACHE_LIMIT = 280;

type BrowseEnvelope = { v: number; limit: number; users: User[] };
type SummaryEnvelope = { v: number; needsHelpCount: number };

function isUserRecord(x: unknown): x is User {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string";
}

function parseBrowse(raw: string | null): User[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BrowseEnvelope;
    if (parsed?.v !== SCHEMA || parsed?.limit !== USUARIOS_BROWSE_CACHE_LIMIT) return null;
    if (!Array.isArray(parsed.users)) return null;
    const users = parsed.users.filter(isUserRecord);
    return users.length > 0 ? users : null;
  } catch {
    return null;
  }
}

/** `requireNonEmpty`: browse no guarda listas vacías; atención/búsqueda sí pueden ser []. */
function parseStoredUserArray(raw: string | null, requireNonEmpty: boolean): User[] | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const users = parsed.filter(isUserRecord);
    if (requireNonEmpty && users.length === 0) return null;
    return users;
  } catch {
    return null;
  }
}

export function readBrowseCache(): User[] | null {
  if (typeof window === "undefined") return null;
  try {
    return parseBrowse(window.localStorage.getItem(BROWSE_KEY));
  } catch {
    return null;
  }
}

export function writeBrowseCache(users: User[]): void {
  if (typeof window === "undefined" || users.length === 0) return;
  try {
    const env: BrowseEnvelope = { v: SCHEMA, limit: USUARIOS_BROWSE_CACHE_LIMIT, users };
    window.localStorage.setItem(BROWSE_KEY, JSON.stringify(env));
  } catch {
    /* quota / privado */
  }
}

export function readAttentionCache(): User[] | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredUserArray(window.localStorage.getItem(ATTENTION_KEY), false);
  } catch {
    return null;
  }
}

export function writeAttentionCache(users: User[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ATTENTION_KEY, JSON.stringify(users));
  } catch {
    /* ignore */
  }
}

export function readSummaryCache(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SUMMARY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SummaryEnvelope;
    if (parsed?.v !== SCHEMA || typeof parsed.needsHelpCount !== "number") return null;
    return parsed.needsHelpCount;
  } catch {
    return null;
  }
}

export function writeSummaryCache(needsHelpCount: number): void {
  if (typeof window === "undefined") return;
  try {
    const env: SummaryEnvelope = { v: SCHEMA, needsHelpCount };
    window.localStorage.setItem(SUMMARY_KEY, JSON.stringify(env));
  } catch {
    /* ignore */
  }
}

function searchStorageKey(q: string): string {
  const norm = q.trim().slice(0, 120);
  return SEARCH_PREFIX + norm;
}

/** `null` = no hay entrada; `[]` = cache válido “sin resultados”. */
export function readSearchCache(q: string): User[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(searchStorageKey(q));
    if (raw === null) return null;
    return parseStoredUserArray(raw, false);
  } catch {
    return null;
  }
}

export function writeSearchCache(q: string, users: User[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(searchStorageKey(q), JSON.stringify(users));
  } catch {
    /* ignore */
  }
}
