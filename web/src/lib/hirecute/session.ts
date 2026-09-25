/**
 * Anonymous sessions (01-architecture.md §4).
 *
 * A cryptographically random token in an HttpOnly cookie. The server stores
 * only its SHA-256 hash, mapped to the run this browser owns.
 *
 * The rule that drives the whole module: "A run ID is an identifier, not
 * permission to read someone else's CV." Ownership is resolved from the cookie
 * on every request — never from a run ID, job ID, artifact ID or path in the
 * request. This is explicitly NOT a login: no password, no email verification,
 * no recovery. Clearing the cookie loses access, and the UI says so.
 */

import { cookies } from "next/headers";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { dataDir, hashToken, newSessionToken, sessionFile } from "@/lib/hirecute/paths";
import { serverConfig } from "@/lib/hirecute/config";
import { ownsRun, type SessionRecord } from "@/lib/hirecute/ownership";

// Re-exported so existing importers keep one import site.
export { ownsRun };
export type { SessionRecord };

export const SESSION_COOKIE = "hirecute_session";


async function readSession(id: string): Promise<SessionRecord | null> {
  try {
    return JSON.parse(await readFile(sessionFile(id), "utf8")) as SessionRecord;
  } catch {
    return null;
  }
}

/** Atomic write: temp file then rename, so a crash cannot truncate a session. */
async function writeSession(record: SessionRecord): Promise<void> {
  const target = sessionFile(record.id);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
  await rename(tmp, target);
}

/** The current session, or null. Never creates one — reads must not mint identity. */
export async function currentSession(): Promise<SessionRecord | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSession(hashToken(token));
}

/**
 * The session for a mutating action, creating one on first use.
 *
 * Called from `POST /runs` and `POST /runs/sample` only — §4: "Create a
 * cryptographically random cookie on the first upload/sample action."
 */
export async function ensureSession(): Promise<SessionRecord> {
  const existing = await currentSession();
  if (existing) return existing;

  const { token, id } = newSessionToken();
  const record: SessionRecord = {
    id,
    createdAt: new Date().toISOString(),
    currentRunId: null,
    ownedRunIds: [],
    stripeCustomerId: null,
  };
  await writeSession(record);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure only over HTTPS, so local http development still works.
    secure: serverConfig().baseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return record;
}

export async function setCurrentRun(session: SessionRecord, runId: string | null): Promise<SessionRecord> {
  const next: SessionRecord = {
    ...session,
    currentRunId: runId,
    ownedRunIds:
      runId && !session.ownedRunIds.includes(runId)
        ? [...session.ownedRunIds, runId]
        : session.ownedRunIds,
  };
  await writeSession(next);
  return next;
}

export async function setStripeCustomer(
  session: SessionRecord,
  customerId: string,
): Promise<SessionRecord> {
  const next = { ...session, stripeCustomerId: customerId };
  await writeSession(next);
  return next;
}


export async function sessionsRoot(): Promise<string> {
  const dir = path.join(dataDir(), "sessions");
  await mkdir(dir, { recursive: true });
  return dir;
}
