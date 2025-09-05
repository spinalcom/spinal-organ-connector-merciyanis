// server.ts
import express from "express";
import crypto from "crypto";
import bodyParser from "body-parser";
import type { Request, Response } from "express";
import type { Server } from "http";

const MERCIYANIS_SECRET = process.env.MERCIYANIS_SECRET || "";

/**
 * Keep a rawBody copy for signature verification.
 */
function rawBodySaver(req: any, _res: any, buf: Buffer, _encoding: BufferEncoding) {
  if (buf && buf.length) req.rawBody = buf;
}

/**
 * Constant-time comparison helper.
 */
function safeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verify the X-MerciYanis-Signature header (sha256=hexdigest)
 */
function verifyMerciYanisSignature(req: Request): boolean {
  if (!MERCIYANIS_SECRET) return false; // enforce signing

  const sigHeader = req.header("X-MerciYanis-Signature") || "";
  const [algo, hex] = sigHeader.split("=");
  if (algo !== "sha256" || !hex) return false;

  // @ts-ignore rawBody added by rawBodySaver
  const rawBody: Buffer = (req as any).rawBody || Buffer.from("");
  const digest = crypto.createHmac("sha256", MERCIYANIS_SECRET).update(rawBody).digest("hex");

  return safeEqual(Buffer.from(hex, "hex"), Buffer.from(digest, "hex"));
}

/**
 * Build and return an Express app (no side effects like .listen here)
 */
export function createServer() {
  const app = express();

  app.use(
    bodyParser.json({
      verify: rawBodySaver,
      limit: "25mb", // matches provider cap
    })
  );

  /**
   * Webhook route
   */
  app.post("/webhooks/merciyanis", (req: Request, res: Response) => {
    const ua = req.header("User-Agent") || "";
    if (!ua.startsWith("MerciYanisHook/")) {
      return res.status(400).send("Invalid User-Agent");
    }

    if (!verifyMerciYanisSignature(req)) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.header("X-MerciYanis-Event") || "UNKNOWN";
    const deliveryId = req.header("X-MerciYanis-Delivery") || "UNKNOWN";
    const hookId = req.header("X-MerciYanis-Hook-ID") || "UNKNOWN";

    console.log(`[MerciYanis] event=${event} delivery=${deliveryId} hook=${hookId}`);

    const payload = req.body;

    // ACK quickly
    res.status(200).send("ok");

    // Process asynchronously
    try {
      switch (event) {
        case "CREATE_TICKET":
          console.log("CREATE_TICKET:", payload?.title ?? "(no title)");
          break;
        default:
          console.log("Unhandled event:", event);
      }
    } catch (e) {
      console.error("Post-ack processing failed:", e);
    }
  });

  app.get("/", (_req, res) => res.send("Ok"));

  return app;
}

/**
 * Start the HTTP server given an optional port.
 * Returns both the app and the Node http.Server instance.
 */
export async function startServer(
  port = Number(process.env.PORT) || 8443
): Promise<{ app: express.Express; server: Server }> {
  const app = createServer();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[server] listening on :${port}`);
      resolve({ app, server });
    });
  });
}
