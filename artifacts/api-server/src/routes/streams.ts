import { Router } from "express";
import {
  fetchH5Streams,
  fetchEpisodeStreams,
  isValidUrl,
} from "../lib/streams-helper.js";

const router = Router();

const BASE_URL = "https://themoviebox.org";

router.get("/streams", async (req, res) => {
  const url = req.query["url"];
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Query parameter 'url' is required" });
    return;
  }

  try {
    const targetUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;
    const parsedUrl = new URL(targetUrl);

    const id = parsedUrl.searchParams.get("id") || "";
    const type = parsedUrl.searchParams.get("type") || "/movie/detail";
    const detailSe = parsedUrl.searchParams.get("detailSe") || "";
    const detailEp = parsedUrl.searchParams.get("detailEp") || "";
    const lang = parsedUrl.searchParams.get("lang") || "en";
    const isTV = type.includes("tv");

    req.log.info({ id, type, detailSe, detailEp }, "Fetching streams");

    let sources = [];

    if (isTV && detailSe && detailEp) {
      sources = await fetchH5Streams(id, detailSe, detailEp);
    }

    if (!sources.length) {
      sources = await fetchEpisodeStreams(id, type, detailSe, detailEp, lang);
    }

    if (!sources.length) {
      const pageResponse = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          Referer: BASE_URL,
        },
      });

      if (pageResponse.ok) {
        const html = await pageResponse.text();
        const { load } = await import("cheerio");
        const $ = load(html);

        $("iframe[src*='//'], iframe[data-src*='//']").each((_, el) => {
          const src = $(el).attr("src") || $(el).attr("data-src") || "";
          if (isValidUrl(src) && !sources.find((s) => s.embedUrl === src)) {
            sources.push({ name: "Embed", embedUrl: src, proxyUrl: `/api/proxy?url=${encodeURIComponent(src)}`, isHLS: src.includes(".m3u8") });
          }
        });

        for (const script of $("script:not([src])").toArray()) {
          const content = $(script).html() || "";
          for (const match of content.matchAll(/["'](https?:\/\/[^"']+\.(?:mp4|m3u8|ts)[^"']*?)["']/g)) {
            const streamUrl = match[1];
            if (isValidUrl(streamUrl) && !sources.find((s) => s.embedUrl === streamUrl)) {
              sources.push({ name: streamUrl.includes(".m3u8") ? "HLS" : "MP4", embedUrl: streamUrl, proxyUrl: `/api/proxy?url=${encodeURIComponent(streamUrl)}`, isHLS: streamUrl.includes(".m3u8") });
            }
          }
        }
      }
    }

    const validSources = sources.filter((s) => isValidUrl(s.embedUrl));

    res.json({
      success: validSources.length > 0,
      id,
      type,
      season: detailSe || null,
      episode: detailEp || null,
      sources: validSources,
      streams: validSources.filter((s) => !s.isHLS),
      hls: validSources.filter((s) => s.isHLS),
    });
  } catch (err) {
    req.log.error({ err }, "Streams error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
