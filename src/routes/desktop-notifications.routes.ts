import { Hono } from "hono";
import {
  authenticateDesktopDestinationCredential,
  getDesktopNotificationServerInstanceId,
} from "../services/push.service";
import { issueDesktopNotificationTicket } from "../ws/tickets";
import { rateLimit } from "../middleware/rate-limit";
import { authLockoutService } from "../services/auth-lockout.service";
import { getClientIp } from "../utils/client-ip";

const app = new Hono();
const ticketLimiter = rateLimit({
  bucket: "desktop-notification-ticket",
  max: 120,
  windowMs: 60 * 1000,
  message: "Too many desktop notification ticket requests. Try again shortly.",
});

app.get("/info", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ serverInstanceId: getDesktopNotificationServerInstanceId() });
});

app.post("/ticket", ticketLimiter, (c) => {
  c.header("Cache-Control", "no-store");
  const authorization = c.req.header("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const destination = match
    ? authenticateDesktopDestinationCredential(match[1].trim())
    : null;
  if (!destination) {
    const clientId = getClientIp(c);
    const result = authLockoutService.recordFailure(clientId, "unauthorized", {
      method: c.req.method,
      path: c.req.path,
    });
    if (result.lockout) {
      c.header("Retry-After", String(Math.max(1, Math.ceil(result.lockout.retryAfterMs / 1000))));
      return c.json(
        authLockoutService.buildPayload(
          result.lockout,
          "Too many invalid desktop notification credentials. Try again later.",
        ),
        429,
      );
    }
    return c.json({ error: "Invalid desktop notification credential" }, 401);
  }
  authLockoutService.recordSuccess(getClientIp(c), "unauthorized");

  return c.json({
    ticket: issueDesktopNotificationTicket(destination.userId, destination.destinationId),
  });
});

export { app as desktopNotificationTransportRoutes };
