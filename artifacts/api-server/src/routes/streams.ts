import { Router } from "express";

const router = Router();

const BASE_URL = "https://themoviebox.org";
const H5_API = "https://h5-api.aoneroom.com/wefeed-h5api-bff";

interface StreamSource {
  name: string;
  embedUrl: string;
  proxyUrl: string;
  isHLS: boolean;
}

async function fetchEpisodeStreams(
  id: string,
  type: string,
  detailSe: string,
  detailEp: string,
  lang: string,
): Promise<StreamSource[]> {
  const sources: StreamSource[] = [];

  const apiEndpoint = `${BASE_URL}/ajax/movie/episode/servers?id=${id}&type=${encodeURIComponent(type)}&detailSe=${detailSe}&detailEp=${detailEp}&lang=${lang}`;

  const apiResponse = await fetch(apiEndpoint, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: BASE_URL,
      Origin: BASE_URL,
    },
  });

  if (!apiResponse.ok) return sources;

  const apiData = (await apiResponse.json()) as Record<string, unknown>;

  if (Array.isArray(apiData["sources"])) {
    for (const source of apiData["sources"] as Record<string, unknown>[]) {
      const srcUrl = String(source["src"] || source["url"] || source["file"] || "");
      if (!srcUrl) continue;
      const isHLS = srcUrl.includes(".m3u8");
      sources.push({
        name: String(source["label"] || source["name"] || "Source"),
        embedUrl: srcUrl,
        proxyUrl: `/api/proxy?url=${encodeURIComponent(srcUrl)}`,
        isHLS,
      });
    }
  }

  if (typeof apiData["html"] === "string" && apiData["html"].length > 0) {
    const { load } = await import("cheerio");
    const $api = load(apiData["html"]);
    const serverIds: Array<{ id: string; name: string }> = [];

    $api("a[data-id], [data-linkid]").each((_, el) => {
      const $el = $api(el);
      const serverId = $el.attr("data-id") || $el.attr("data-linkid") || "";
      if (serverId) serverIds.push({ id: serverId, name: $el.text().trim() || serverId });
    });

    for (const server of serverIds) {
      try {
        const srcRes = await fetch(
          `${BASE_URL}/ajax/movie/episode/server/sources?id=${server.id}`,
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "X-Requested-With": "XMLHttpRequest",
              Referer: BASE_URL,
            },
          },
        );
        if (!srcRes.ok) continue;
        const srcData = (await srcRes.json()) as Record<string, unknown>;
        const url = String(
          (srcData["data"] as Record<string, unknown>)?.["link"] ||
          srcData["url"] ||
          srcData["src"] ||
          "",
        );
        if (url) {
          const isHLS = url.includes(".m3u8");
          sources.push({
            name: server.name,
            embedUrl: url,
            proxyUrl: `/api/proxy?url=${encodeURIComponent(url)}`,
            isHLS,
          });
        }
      } catch {
        continue;
      }
    }
  }

  if (typeof apiData["link"] === "string" && apiData["link"]) {
    const url = apiData["link"] as string;
    sources.push({
      name: "API Stream",
      embedUrl: url,
      proxyUrl: `/api/proxy?url=${encodeURIComponent(url)}`,
      isHLS: url.includes(".m3u8"),
    });
  }

  return sources;
}

async function fetchH5Streams(
  subjectId: string,
  season: string,
  episode: string,
): Promise<StreamSource[]> {
  const sources: StreamSource[] = [];
  try {
    const res = await fetch(`${H5_API}/subject/episode/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
      },
      body: JSON.stringify({ subjectId, se: Number(season) || 1, ep: Number(episode) || 1 }),
    });
    if (!res.ok) return sources;
    const data = (await res.json()) as Record<string, unknown>;
    const items = (data["data"] as Record<string, unknown>)?.["streams"] ||
      (data["data"] as unknown) ||
      data["streams"];
    if (Array.isArray(items)) {
      for (const item of items as Record<string, unknown>[]) {
        const url = String(item["url"] || item["src"] || item["link"] || "");
        if (!url) continue;
        sources.push({
          name: String(item["format"] || item["label"] || "Stream"),
          embedUrl: url,
          proxyUrl: `/api/proxy?url=${encodeURIComponent(url)}`,
          isHLS: url.includes(".m3u8"),
        });
      }
    }
  } catch {
    return sources;
  }
  return sources;
}

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

    let sources: StreamSource[] = [];

    if (isTV && detailSe && detailEp) {
      sources = await fetchH5Streams(id, detailSe, detailEp);
    }

    if (!sources.length) {
      sources = await fetchEpisodeStreams(id, type, detailSe, detailEp, lang);
    }

    if (!sources.length) {
      const pageResponse = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
          if (src && !sources.find((s) => s.embedUrl === src)) {
            sources.push({ name: "Embed", embedUrl: src, proxyUrl: `/api/proxy?url=${encodeURIComponent(src)}`, isHLS: false });
          }
        });

        for (const script of $("script:not([src])").toArray()) {
          const content = $(script).html() || "";
          for (const match of content.matchAll(/["'](https?:\/\/[^"']+\.(?:mp4|m3u8|ts)[^"']*?)["']/g)) {
            const streamUrl = match[1];
            if (!sources.find((s) => s.embedUrl === streamUrl)) {
              sources.push({
                name: streamUrl.includes(".m3u8") ? "HLS" : "MP4",
                embedUrl: streamUrl,
                proxyUrl: `/api/proxy?url=${encodeURIComponent(streamUrl)}`,
                isHLS: streamUrl.includes(".m3u8"),
              });
            }
          }
        }
      }
    }

    const success = sources.length > 0;
    res.json({
      success,
      id,
      type,
      season: detailSe || null,
      episode: detailEp || null,
      sources,
      streams: sources.filter((s) => !s.isHLS),
      hls: sources.filter((s) => s.isHLS),
    });
  } catch (err) {
    req.log.error({ err }, "Streams error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
