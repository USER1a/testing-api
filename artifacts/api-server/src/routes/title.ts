import { Router } from "express";
import { searchMovies } from "./search.js";

const router = Router();

const SITE_BASE = "https://themoviebox.org";
const UPSTREAM_STREAMS = "https://testing-api-server.vercel.app/api/streams";

interface UpstreamStream {
  format: string;
  id: string;
  url: string;
  resolutions: string;
  size: string;
  duration: number;
  codecName: string;
}

interface UpstreamResponse {
  success: boolean;
  subjectId: string;
  slug: string;
  title: string;
  coverUrl: string;
  se: number;
  ep: number;
  streams: UpstreamStream[];
  hls: Array<{ url: string }>;
  dash: Array<{ url: string }>;
  freeNum: number;
  limited: boolean;
}

function buildMovieboxUrl(
  detailPath: string,
  subjectId: string,
  subjectType: number,
  season: number | null,
  episode: number | null,
): string {
  const isTV = subjectType !== 0 || season !== null || episode !== null;
  const type = isTV ? "/tv/detail" : "/movie/detail";
  const detailSe = season !== null ? String(season) : "";
  const detailEp = episode !== null ? String(episode) : "";
  return (
    `${SITE_BASE}/movies/${detailPath}` +
    `?id=${subjectId}&type=${encodeURIComponent(type)}&detailSe=${detailSe}&detailEp=${detailEp}&lang=en`
  );
}

async function fetchStreams(movieboxUrl: string): Promise<UpstreamResponse | null> {
  try {
    const res = await fetch(
      `${UPSTREAM_STREAMS}?url=${encodeURIComponent(movieboxUrl)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as UpstreamResponse;
    if (!data.success || !data.streams?.length) return null;
    return data;
  } catch {
    return null;
  }
}

router.get("/title", async (req, res) => {
  const stream = req.query["stream"];
  if (!stream || typeof stream !== "string" || stream.trim() === "") {
    res.status(400).json({
      error: "Query parameter 'stream' is required",
      usage: "/api/title?stream=ShowName&season=1&episode=1",
      shortForm: "/api/title?stream=ShowName&s=1&e=1",
      example: "/api/title?stream=Jujutsu+Kaisen&s=1&e=3",
    });
    return;
  }

  const seasonRaw = req.query["season"] ?? req.query["s"];
  const episodeRaw = req.query["episode"] ?? req.query["e"];
  const season = seasonRaw ? parseInt(String(seasonRaw), 10) : null;
  const episode = episodeRaw ? parseInt(String(episodeRaw), 10) : null;

  const query = stream.trim();
  req.log.info({ query, season, episode }, "Title stream lookup");

  try {
    const results = await searchMovies(query);

    if (!results.length) {
      res.status(404).json({ error: `No results found for "${query}"` });
      return;
    }

    const host =
      req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const baseUrl = `${protocol}://${host}`;

    let upstreamData: UpstreamResponse | null = null;
    let foundMovie = null;

    for (const movie of results.filter((r) => r.hasResource)) {
      const movieboxUrl = buildMovieboxUrl(
        movie.detailPath,
        movie.subjectId,
        movie.subjectType,
        season,
        episode,
      );
      req.log.info({ url: movieboxUrl }, "Trying URL for streams");
      upstreamData = await fetchStreams(movieboxUrl);
      if (upstreamData) {
        foundMovie = movie;
        break;
      }
    }

    if (!upstreamData || !foundMovie) {
      res.status(502).json({
        error: "Could not fetch streams for this title.",
        hint: "Try omitting season/episode to get the default, or check the title spelling.",
        query,
        season,
        episode,
      });
      return;
    }

    const streams = upstreamData.streams
      .filter((s) => s.url && s.url.startsWith("http"))
      .map((s) => {
        const playerUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(s.url)}`;
        return {
          format: s.format,
          resolution: `${s.resolutions}p`,
          duration: s.duration,
          sizeMB: s.size ? Math.round(Number(s.size) / 1024 / 1024) : null,
          codec: s.codecName,
          originalUrl: s.url,
          playerUrl,
          iframe: `<iframe src="${playerUrl}" width="100%" height="500" allowfullscreen frameborder="0" allow="autoplay; encrypted-media"></iframe>`,
        };
      });

    const hlsStreams = upstreamData.hls
      .filter((h) => h.url && h.url.startsWith("http"))
      .map((h) => ({
        originalUrl: h.url,
        playerUrl: `${baseUrl}/api/proxy?url=${encodeURIComponent(h.url)}`,
      }));

    const primaryStream = streams[streams.length - 1] || null;

    res.json({
      query,
      requested: { season, episode },
      returned: { season: upstreamData.se, episode: upstreamData.ep },
      movie: {
        title: upstreamData.title || foundMovie.title,
        subjectId: foundMovie.subjectId,
        subjectType: foundMovie.subjectType,
        poster: upstreamData.coverUrl || foundMovie.poster,
        genre: foundMovie.genre,
        releaseDate: foundMovie.releaseDate,
        country: foundMovie.country,
        imdbRating: foundMovie.imdbRating,
        movieboxUrl: buildMovieboxUrl(
          foundMovie.detailPath,
          foundMovie.subjectId,
          foundMovie.subjectType,
          season,
          episode,
        ),
      },
      playerUrl: primaryStream?.playerUrl || null,
      embedIframe: primaryStream?.iframe || null,
      streams,
      hls: hlsStreams,
    });
  } catch (err) {
    req.log.error({ err }, "Title stream error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
