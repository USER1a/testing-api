import { Router } from "express";
import { searchMovies } from "./search.js";

const router = Router();

const STREAMS_API = "https://testing-api-server.vercel.app/api/streams";

interface StreamItem {
  format: string;
  id: string;
  url: string;
  resolutions: string;
  size: string;
  duration: number;
  codecName: string;
}

async function fetchStreamsForUrl(movieboxUrl: string): Promise<{
  success: boolean;
  streams: StreamItem[];
  hls: Array<{ url: string }>;
  title: string;
  coverUrl: string;
  se: number;
  ep: number;
  freeNum: number;
  limited: boolean;
} | null> {
  try {
    const res = await fetch(
      `${STREAMS_API}?url=${encodeURIComponent(movieboxUrl)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { success: boolean; streams?: StreamItem[]; hls?: Array<{ url: string }>; title?: string; coverUrl?: string; se?: number; ep?: number; freeNum?: number; limited?: boolean };
    if (!data.success || !data.streams?.length) return null;
    return {
      success: true,
      streams: data.streams || [],
      hls: data.hls || [],
      title: data.title || "",
      coverUrl: data.coverUrl || "",
      se: data.se ?? 1,
      ep: data.ep ?? 1,
      freeNum: data.freeNum ?? 0,
      limited: data.limited ?? false,
    };
  } catch {
    return null;
  }
}

router.get("/title", async (req, res) => {
  const stream = req.query["stream"];
  if (!stream || typeof stream !== "string" || stream.trim() === "") {
    res.status(400).json({
      error: "Query parameter 'stream' is required",
      usage: "/api/title?stream=MovieName",
      example: "/api/title?stream=Sankalp",
    });
    return;
  }

  const query = stream.trim();
  req.log.info({ query }, "Title stream lookup");

  try {
    const results = await searchMovies(query);

    if (!results.length) {
      res.status(404).json({ error: `No results found for "${query}"` });
      return;
    }

    const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const baseUrl = `${protocol}://${host}`;

    let streamsData = null;
    let foundMovie = null;

    for (const movie of results.filter((r) => r.hasResource)) {
      req.log.info({ url: movie.movieboxUrl }, "Trying URL for streams");
      streamsData = await fetchStreamsForUrl(movie.movieboxUrl);
      if (streamsData) {
        foundMovie = movie;
        break;
      }
    }

    if (!streamsData || !foundMovie) {
      res.status(502).json({
        error: "Could not fetch streams for any search result",
        query,
        tried: results.filter((r) => r.hasResource).map((r) => r.movieboxUrl),
      });
      return;
    }

    const streams = streamsData.streams.map((s) => {
      const proxyUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(s.url)}`;
      return {
        format: s.format,
        resolution: `${s.resolutions}p`,
        duration: s.duration,
        sizeMB: Math.round(Number(s.size) / 1024 / 1024),
        codec: s.codecName,
        originalUrl: s.url,
        proxyUrl,
        iframe: `<iframe src="${proxyUrl}" width="100%" height="500" allowfullscreen frameborder="0" allow="autoplay; encrypted-media"></iframe>`,
      };
    });

    const hlsStreams = streamsData.hls.map((h) => {
      const proxyUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(h.url)}`;
      return { originalUrl: h.url, proxyUrl };
    });

    const primaryStream = streams[streams.length - 1] || null;

    res.json({
      query,
      movie: {
        title: streamsData.title || foundMovie.title,
        movieboxUrl: foundMovie.movieboxUrl,
        subjectId: foundMovie.subjectId,
        poster: streamsData.coverUrl || foundMovie.poster,
        genre: foundMovie.genre,
        releaseDate: foundMovie.releaseDate,
        country: foundMovie.country,
        imdbRating: foundMovie.imdbRating,
      },
      streams,
      hls: hlsStreams,
      primaryStream,
      embedUrl: primaryStream?.proxyUrl || null,
      embedIframe: primaryStream?.iframe || null,
    });
  } catch (err) {
    req.log.error({ err }, "Title stream error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
