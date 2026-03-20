const BASE_URL = "https://themoviebox.org";
const H5_API = "https://h5-api.aoneroom.com/wefeed-h5api-bff";

export interface StreamSource {
  name: string;
  embedUrl: string;
  proxyUrl: string;
  isHLS: boolean;
}

export function isValidUrl(url: unknown): url is string {
  return (
    typeof url === "string" &&
    url.length > 0 &&
    (url.startsWith("http://") || url.startsWith("https://")) &&
    url !== "undefined" &&
    url !== "null"
  );
}

export function makeSource(name: string, url: string): StreamSource {
  return {
    name,
    embedUrl: url,
    proxyUrl: `/api/proxy?url=${encodeURIComponent(url)}`,
    isHLS: url.includes(".m3u8"),
  };
}

export function extractUrl(obj: Record<string, unknown>): string | null {
  const candidates = [
    obj["url"], obj["src"], obj["link"], obj["file"],
    obj["hls"], obj["mp4"], obj["stream"], obj["href"],
  ];
  for (const val of candidates) {
    if (isValidUrl(val)) return val;
  }
  return null;
}

export async function fetchEpisodeStreams(
  id: string,
  type: string,
  detailSe: string,
  detailEp: string,
  lang: string,
): Promise<StreamSource[]> {
  const sources: StreamSource[] = [];

  try {
    const apiEndpoint = `${BASE_URL}/ajax/movie/episode/servers?id=${id}&type=${encodeURIComponent(type)}&detailSe=${detailSe}&detailEp=${detailEp}&lang=${lang}`;
    const apiResponse = await fetch(apiEndpoint, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
        const url = extractUrl(source);
        if (url) {
          sources.push(makeSource(
            String(source["label"] || source["name"] || "Source"),
            url,
          ));
        }
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

          const nested = srcData["data"] as Record<string, unknown> | undefined;
          const url = (nested ? extractUrl(nested) : null) ?? extractUrl(srcData);
          if (url) sources.push(makeSource(server.name, url));
        } catch {
          continue;
        }
      }
    }

    const topUrl = extractUrl(apiData);
    if (topUrl) sources.push(makeSource("API Stream", topUrl));
  } catch {
    return sources;
  }

  return sources;
}

export async function fetchH5Streams(
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

    const dataField = data["data"] as Record<string, unknown> | undefined;
    const rawItems =
      (dataField?.["streams"]) ??
      (Array.isArray(dataField) ? dataField : null) ??
      data["streams"];

    if (Array.isArray(rawItems)) {
      for (const item of rawItems as Record<string, unknown>[]) {
        const url = extractUrl(item);
        if (url) {
          sources.push(makeSource(
            String(item["format"] || item["label"] || item["quality"] || "Stream"),
            url,
          ));
        }
      }
    }
  } catch {
    return sources;
  }
  return sources;
}

export async function resolveStreams(
  movieboxUrl: string,
): Promise<StreamSource[]> {
  const parsed = new URL(movieboxUrl);
  const id = parsed.searchParams.get("id") || "";
  const type = parsed.searchParams.get("type") || "/movie/detail";
  const detailSe = parsed.searchParams.get("detailSe") || "";
  const detailEp = parsed.searchParams.get("detailEp") || "";
  const lang = parsed.searchParams.get("lang") || "en";
  const isTV = type.includes("tv");

  let sources: StreamSource[] = [];

  if (isTV && detailSe && detailEp) {
    sources = await fetchH5Streams(id, detailSe, detailEp);
  }

  if (!sources.length) {
    sources = await fetchEpisodeStreams(id, type, detailSe, detailEp, lang);
  }

  return sources.filter((s) => isValidUrl(s.embedUrl));
}
