import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";

const db = new Database(":memory:");
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES ('owner'),('other');");
for (const file of ["035_push_subscriptions", "117_desktop_notification_destinations", "127_ios_push_destinations", "130_android_push_destinations"])
  db.exec(await Bun.file(new URL(`../db/migrations/${file}.sql`, import.meta.url)).text());
mock.module("../db/connection", () => ({ getDb: () => db }));
mock.module("../crypto/init", () => ({ getEncryptionKeyBytes: () => new Uint8Array(32).fill(7) }));
mock.module("../crypto/vapid", () => ({ getVapidPublicKey: () => "android-test-key", getVapidPrivateJWK: () => ({}) }));
mock.module("../services/settings.service", () => ({ getSetting: () => null }));
mock.module("../utils/safe-fetch", () => ({ validateHost: async () => {}, SSRFError: class extends Error {} }));
mock.module("../services/apns.service", () => ({ getAPNsInfo: () => ({ configured: false }), sendAPNsNotification: async () => ({ sent: false }) }));
mock.module("../services/ios-avatar-thumbnail", () => ({ iosAvatarThumbnail: async (user: string, char: string) =>
  new Response(user === "owner" && char === "character" ? "jpeg-thumbnail" : null, { status: user === "owner" && char === "character" ? 200 : 404 }) }));
const { androidNotificationTransportRoutes } = await import("./android-notifications.routes");
const { pushRoutes } = await import("./push.routes");
const service = await import("../services/android-notifications.service");
const { sendPushToUser } = await import("../services/push.service");
const { eventBus } = await import("../ws/bus");
const { consumeDesktopNotificationTicket } = await import("../ws/tickets");
const app = new Hono();
app.use("/push/*", async (c, next) => { c.set("userId", c.req.header("x-user") || "owner"); await next() });
app.route("/push", pushRoutes); app.route("/native", androidNotificationTransportRoutes);
const oldHost = process.env.LUMIVERSE_ANDROID_HOST;
const oldFCM = process.env.FCM_SERVICE_ACCOUNT_PATH;
beforeEach(() => { db.exec("DELETE FROM android_push_destinations"); process.env.LUMIVERSE_ANDROID_HOST = "tauri"; delete process.env.FCM_SERVICE_ACCOUNT_PATH });
afterAll(() => {
  if (oldHost === undefined) delete process.env.LUMIVERSE_ANDROID_HOST; else process.env.LUMIVERSE_ANDROID_HOST = oldHost;
  if (oldFCM === undefined) delete process.env.FCM_SERVICE_ACCOUNT_PATH; else process.env.FCM_SERVICE_ACCOUNT_PATH = oldFCM;
  eventBus.stopSweep(); db.close(); mock.restore();
});
const input = { deviceId: "android-installation-12345678", transport: "local" as const, serverOrigin: "http://127.0.0.1:7860" };
const enroll = (user = "owner") => service.createAndroidDestination(user, input);
const ticket = (credential: string) => app.request("/native/ticket", { method: "POST", headers: { Authorization: `Bearer ${credential}` } });

test("enrolls, lists and tests an Android destination using only the notification socket", async () => {
  const response = await app.request("/push/android", { method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" } });
  expect(response.status).toBe(201);
  const value = await response.json();
  const listed = await (await app.request("/push/subscriptions")).json();
  expect(listed[0].type).toBe("android_native");
  expect(JSON.stringify(listed)).not.toContain(value.credential);
  expect(listed[0]).not.toHaveProperty("device_token");
  const messages: string[] = [];
  const socket = { readyState: 1, send: (text: string) => messages.push(text), close: () => {} };
  eventBus.addDesktopNotificationClient(socket as never, "owner", value.destination.id);
  try {
    const testResponse = await app.request("/push/subscriptions/test", { method: "POST", body: JSON.stringify({ destinationId: value.destination.id }) });
    expect((await testResponse.json()).sent).toBe(1);
    expect(JSON.parse(messages[0]!).payload.body).toContain("working");
    expect(await sendPushToUser("other", { title: "Other account", body: "private" })).toBe(0);
    expect(messages).toHaveLength(1);
  } finally { eventBus.removeClient(socket as never) }
});

test("account transfer revokes credentials, outstanding tickets, sockets and avatar capabilities", async () => {
  const first = enroll();
  const issued = await (await ticket(first.credential)).json();
  expect(issued.serverInstanceId).toBe(first.serverInstanceId);
  const path = service.androidAvatarPath(first.destination.id, "character");
  const nativePath = path.replace("/api/android-notifications/v1", "/native");
  expect((await app.request(nativePath)).status).toBe(200);
  const second = enroll("other");
  expect(second.destination.id).not.toBe(first.destination.id);
  expect(consumeDesktopNotificationTicket(issued.ticket)).toBeNull();
  expect((await ticket(first.credential)).status).toBe(401);
  expect((await app.request(nativePath)).status).toBe(404);
  expect(service.listAndroidDestinations("owner")).toHaveLength(0);
  expect(service.deleteAndroidDestination("owner", second.destination.id)).toBe(false);
  expect(service.deleteAndroidDestination("other", second.destination.id)).toBe(true);
  expect((await ticket(second.credential)).status).toBe(401);
});

test("tickets are single-use and media capabilities cannot be tampered with or extended", async () => {
  const value = enroll();
  const issued = await (await ticket(value.credential)).json();
  expect(consumeDesktopNotificationTicket(issued.ticket)?.destinationId).toBe(value.destination.id);
  expect(consumeDesktopNotificationTicket(issued.ticket)).toBeNull();
  const path = new URL(service.androidAvatarPath(value.destination.id, "character"), "http://example.test");
  expect(service.verifyAndroidAvatar(value.destination.id, "other", path.searchParams.get("expires")!, path.searchParams.get("signature")!)).toBe(false);
  expect(service.verifyAndroidAvatar(value.destination.id, "character", path.searchParams.get("expires")!, path.searchParams.get("signature")!, Number(path.searchParams.get("expires")))).toBe(false);
});

test("local enrollment cannot be used on remote servers, and remote enrollment reports missing configuration", async () => {
  expect(() => service.createAndroidDestination("owner", { ...input, accountId: "other" })).toThrow("account changed");
  expect(() => service.createAndroidDestination("owner", { ...input, serverOrigin: "https://chat.example" })).toThrow("embedded Android");
  delete process.env.LUMIVERSE_ANDROID_HOST;
  expect(() => enroll()).toThrow("embedded Android");
  const response = await app.request("/push/android", { method: "POST", body: JSON.stringify({ ...input, transport: "fcm" }) });
  expect(response.status).toBe(503);
});

test("presence suppresses normal Android delivery and per-device tests bypass it", async () => {
  const value = enroll();
  const messages: string[] = [];
  const socket = { readyState: 1, send: (text: string) => messages.push(text), close: () => {} };
  eventBus.addDesktopNotificationClient(socket as never, "owner", value.destination.id);
  eventBus.setUserVisibility("owner", "android-session", true);
  try {
    expect(await sendPushToUser("owner", { title: "Reply", body: "text" })).toBe(0);
    expect(await sendPushToUser("owner", { title: "Generation Failed", body: "Provider unavailable", tag: "generation-error-chat" }, { bypassPresence: true, destinationId: value.destination.id })).toBe(1);
    expect(JSON.parse(messages[0]!).payload.data.error).toBe(true);
  } finally { eventBus.removeClient(socket as never); eventBus.setUserVisibility("owner", "android-session", false) }
});
