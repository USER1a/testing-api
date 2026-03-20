import { Router, type IRouter } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import https from "https";
import http from "http";

const router: IRouter = Router();

router.get("/proxy", async (req, res) => {
  const url = req.query["url"];
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Query parameter 'url' is required" });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL provided" });
    return;
  }

  const proxyHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    Referer: "https://themoviebox.org/",
    Origin: "https://themoviebox.org",
  };

  const rangeHeader = req.headers["range"];
  if (rangeHeader) {
    proxyHeaders["Range"] = rangeHeader;
  }

  req.log.info({ targetUrl: targetUrl.toString() }, "Proxying request");

  const transport = targetUrl.protocol === "https:" ? https : http;

  const proxyReq = transport.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: "GET",
      headers: proxyHeaders,
    },
    (proxyRes: IncomingMessage) => {
      const statusCode = proxyRes.statusCode || 200;

      const responseHeaders: Record<string, string | string[]> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
        "X-Frame-Options": "ALLOWALL",
      };

      const passthroughHeaders = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
        "last-modified",
        "etag",
      ];

      for (const header of passthroughHeaders) {
        const value = proxyRes.headers[header];
        if (value) {
          responseHeaders[header] = value;
        }
      }

      res.writeHead(statusCode, responseHeaders);
      proxyRes.pipe(res as unknown as ServerResponse);
    },
  );

  proxyReq.on("error", (err) => {
    req.log.error({ err }, "Proxy request error");
    if (!res.headersSent) {
      res.status(502).json({ error: "Failed to proxy request" });
    }
  });

  req.on("close", () => {
    proxyReq.destroy();
  });

  proxyReq.end();
});

router.options("/proxy", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.sendStatus(204);
});

export default router;
