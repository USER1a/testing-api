import { Router, type IRouter } from "express";

const router: IRouter = Router();

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

    req.log.info({ targetUrl, id, type }, "Fetching streams for URL");

    const pageResponse = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Referer: BASE_URL,
      },
    });

    if (!pageResponse.ok) {
      req.log.error({ status: pageResponse.status }, "Page fetch failed");
      res.status(502).json({ error: "Failed to fetch page" });
      return;
    }

    const html = await pageResponse.text();
    const { load } = await import("cheerio");
    const $ = load(html);

    const sources: Array<{
      name: string;
      embedUrl: string;
      proxyUrl: string;
    }> = [];

    const iframeEl = $("iframe[src*='//'], iframe[data-src*='//']");
    iframeEl.each((_, el) => {
      const src =
        $(el).attr("src") || $(el).attr("data-src") || "";
      if (src && !sources.find((s) => s.embedUrl === src)) {
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(src)}`;
        sources.push({ name: "Embed", embedUrl: src, proxyUrl });
      }
    });

    const scriptTags = $("script:not([src])").toArray();
    for (const script of scriptTags) {
      const scriptContent = $(script).html() || "";

      const mp4Matches = scriptContent.matchAll(
        /["'](https?:\/\/[^"']+\.(?:mp4|m3u8|ts)[^"']*?)["']/g,
      );
      for (const match of mp4Matches) {
        const streamUrl = match[1];
        if (!sources.find((s) => s.embedUrl === streamUrl)) {
          const proxyUrl = `/api/proxy?url=${encodeURIComponent(streamUrl)}`;
          sources.push({ name: "Direct", embedUrl: streamUrl, proxyUrl });
        }
      }

      const iframeMatches = scriptContent.matchAll(
        /["'](https?:\/\/[^"']*(?:embed|player|stream|play)[^"']*?)["']/gi,
      );
      for (const match of iframeMatches) {
        const embedUrl = match[1];
        if (
          !sources.find((s) => s.embedUrl === embedUrl) &&
          !embedUrl.includes(BASE_URL)
        ) {
          const proxyUrl = `/api/proxy?url=${encodeURIComponent(embedUrl)}`;
          sources.push({ name: "Player", embedUrl, proxyUrl });
        }
      }
    }

    const apiEndpoint = `${BASE_URL}/ajax/movie/episode/servers?id=${id}&type=${encodeURIComponent(type)}&detailSe=${detailSe}&detailEp=${detailEp}&lang=${lang}`;
    req.log.info({ apiEndpoint }, "Trying API endpoint for sources");

    try {
      const apiResponse = await fetch(apiEndpoint, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          Referer: targetUrl,
          Origin: BASE_URL,
        },
      });

      if (apiResponse.ok) {
        const apiData = (await apiResponse.json()) as unknown;
        req.log.info({ apiData }, "Got API response");

        if (typeof apiData === "object" && apiData !== null) {
          const data = apiData as Record<string, unknown>;
          if (Array.isArray(data["sources"])) {
            for (const source of data["sources"] as unknown[]) {
              if (
                typeof source === "object" &&
                source !== null
              ) {
                const s = source as Record<string, unknown>;
                const srcUrl = String(s["src"] || s["url"] || s["file"] || "");
                const label = String(s["label"] || s["name"] || "Source");
                if (srcUrl && !sources.find((x) => x.embedUrl === srcUrl)) {
                  sources.push({
                    name: label,
                    embedUrl: srcUrl,
                    proxyUrl: `/api/proxy?url=${encodeURIComponent(srcUrl)}`,
                  });
                }
              }
            }
          }

          if (
            typeof data["html"] === "string" &&
            data["html"].length > 0
          ) {
            const $api = load(data["html"]);
            $api("a[data-id], [data-linkid]").each((_, el) => {
              const $el = $api(el);
              const serverId =
                $el.attr("data-id") || $el.attr("data-linkid") || "";
              const serverName = $el.text().trim();
              if (serverId) {
                sources.push({
                  name: serverName || serverId,
                  embedUrl: `${BASE_URL}/ajax/movie/episode/server/sources?id=${serverId}`,
                  proxyUrl: `/api/proxy?url=${encodeURIComponent(`${BASE_URL}/ajax/movie/episode/server/sources?id=${serverId}`)}`,
                });
              }
            });
          }
        }
      }
    } catch (apiErr) {
      req.log.warn({ apiErr }, "API endpoint attempt failed, using scraped sources");
    }

    res.json({
      url: targetUrl,
      id,
      type,
      sources,
      iframeEmbeds: sources.map((s) => ({
        name: s.name,
        iframe: `<iframe src="${s.proxyUrl}" width="100%" height="500" allowfullscreen frameborder="0"></iframe>`,
        directProxyUrl: s.proxyUrl,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Streams error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
