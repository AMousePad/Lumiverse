import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "../db/connection";
import { getEncryptionKeyBytes } from "../crypto/init";
import { getVapidPublicKey } from "../crypto/vapid";
import { eventBus } from "../ws/bus";
import { invalidateDesktopNotificationTickets } from "../ws/tickets";
import { getFCMInfo, sendFCMNotification, boundedAndroidPayload } from "./fcm.service";
import type { AndroidPushDestinationRecord, CreateAndroidPushDestinationInput, PushPayload } from "../types/push";

type PrivateDestination = Omit<AndroidPushDestinationRecord, "type"> & { device_token: string | null; server_origin: string; registered_at: number };
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const androidServerInstanceId = () => `lvdi_${createHash("sha256").update(getVapidPublicKey()).digest("base64url").slice(0, 32)}`;
export function getAndroidNotificationInfo() { return { ...getFCMInfo(), serverInstanceId: androidServerInstanceId() } }
export function listAndroidDestinations(userId: string): AndroidPushDestinationRecord[] {
  return (getDb().query(`SELECT id, user_id, device_id, transport, project_id, label, user_agent, created_at, updated_at
    FROM android_push_destinations WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as Array<Omit<AndroidPushDestinationRecord, "type">>)
    .map(row => ({ ...row, type: "android_native" }));
}
function revoke(userId: string, id: string) {
  invalidateDesktopNotificationTickets(userId, id);
  eventBus.disconnectDesktopNotificationDestination(userId, id);
}
export function createAndroidDestination(userId: string, input: CreateAndroidPushDestinationInput) {
  if (!input || !validId(input.deviceId) || input.deviceId.length < 16 || !["local", "fcm"].includes(input.transport))
    throw new Error("Invalid Android destination");
  if (input.accountId !== undefined && input.accountId !== userId) throw new Error("The account changed during notification enrollment");
  const origin = new URL(input.serverOrigin);
  if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== input.serverOrigin || input.serverOrigin.length > 512)
    throw new Error("Invalid Android server origin");
  if (input.transport === "local") {
    if (!process.env.LUMIVERSE_ANDROID_HOST || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
      throw new Error("Local notifications require the embedded Android backend");
  } else {
    const info = getFCMInfo();
    if (!info.configured || input.projectId !== info.projectId) throw new Error(info.reason || "The APK and server Firebase projects do not match");
    if (typeof input.deviceToken !== "string" || !/^[A-Za-z0-9_:.-]{32,4096}$/.test(input.deviceToken)) throw new Error("Invalid FCM token");
  }
  const credential = `lva_${randomBytes(32).toString("base64url")}`, now = Math.floor(Date.now() / 1000);
  return getDb().transaction(() => {
    const old = getDb().query(`SELECT id, user_id FROM android_push_destinations WHERE device_id = ? OR (device_token IS NOT NULL AND device_token = ?)`)
      .all(input.deviceId, input.deviceToken ?? null) as Array<{ id: string; user_id: string }>;
    for (const row of old) { getDb().query("DELETE FROM android_push_destinations WHERE id = ?").run(row.id); revoke(row.user_id, row.id) }
    // A new ID makes delayed pushes from an earlier account/enrollment unusable.
    const id = crypto.randomUUID();
    getDb().query(`INSERT INTO android_push_destinations
      (id,user_id,device_id,transport,device_token,project_id,server_origin,token_hash,label,user_agent,created_at,updated_at,registered_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, input.deviceId, input.transport,
        input.transport === "fcm" ? input.deviceToken! : null, input.transport === "fcm" ? input.projectId! : null,
        origin.origin, hash(credential), typeof input.label === "string" ? input.label.slice(0, 100) : "Lumiverse Android",
        typeof input.userAgent === "string" ? input.userAgent.slice(0, 500) : "", now, now, Date.now());
    return { destination: listAndroidDestinations(userId).find(row => row.id === id)!, credential, serverInstanceId: androidServerInstanceId() };
  })();
}
export function authenticateAndroidCredential(credential: string) {
  if (!/^lva_[A-Za-z0-9_-]{43}$/.test(credential)) return null;
  const row = getDb().query("SELECT id, user_id FROM android_push_destinations WHERE token_hash = ? AND transport = 'local'")
    .get(hash(credential)) as { id: string; user_id: string } | null;
  return row ? { destinationId: row.id, userId: row.user_id } : null;
}
export function deleteAndroidDestination(userId: string, id: string): boolean {
  const deleted = getDb().query("DELETE FROM android_push_destinations WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  if (deleted) revoke(userId, id);
  return deleted;
}

function avatarProof(destinationId: string, characterId: string, expires: number) {
  return createHmac("sha256", getEncryptionKeyBytes()).update(JSON.stringify(["lumiverse-android-avatar-v1", destinationId, characterId, expires])).digest();
}
export function androidAvatarPath(destinationId: string, characterId: string, now = Math.floor(Date.now() / 1000)) {
  const expires = now + 3900;
  return `/api/android-notifications/v1/avatar/${destinationId}/${characterId}?expires=${expires}&signature=${avatarProof(destinationId, characterId, expires).toString("base64url")}`;
}
export function verifyAndroidAvatar(destinationId: string, characterId: string, expiry?: string, proof?: string, now = Math.floor(Date.now() / 1000)) {
  if (!validId(destinationId) || !validId(characterId) || !/^\d{1,12}$/.test(expiry ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(proof ?? "")) return false;
  const expires = Number(expiry);
  return expires > now && expires <= now + 3900 && timingSafeEqual(Buffer.from(proof!, "base64url"), avatarProof(destinationId, characterId, expires));
}
export async function sendAndroidNotifications(userId: string, notification: PushPayload, destinationId?: string, shouldSend = () => true) {
  const rows = getDb().query("SELECT * FROM android_push_destinations WHERE user_id = ?").all(userId) as PrivateDestination[];
  const results = await Promise.allSettled(rows.filter(row => !destinationId || row.id === destinationId).map(async row => {
    if (!shouldSend()) return 0;
    const characterId = notification.icon?.match(/^\/api\/v1\/characters\/([A-Za-z0-9_-]{1,128})\/avatar\?size=sm$/)?.[1];
    const payload = boundedAndroidPayload(notification, characterId ? androidAvatarPath(row.id, characterId) : undefined);
    if (row.transport === "local") return eventBus.sendDesktopNotification(userId, [row.id], JSON.parse(payload));
    const result = await sendFCMNotification(row.device_token!, { payload, destinationId: row.id,
      serverOrigin: row.server_origin, serverInstanceId: androidServerInstanceId() }, shouldSend);
    if (result.invalidToken) getDb().query("DELETE FROM android_push_destinations WHERE id = ? AND device_token = ? AND registered_at = ?")
      .run(row.id, row.device_token, row.registered_at);
    return result.sent ? 1 : 0;
  }));
  return results.reduce((count, result) => count + (result.status === "fulfilled" ? result.value : 0), 0);
}
