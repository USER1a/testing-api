import { Router } from "express";
import { searchMovies } from "./search.js";
import { resolveStreams } from "../lib/streams-helper.js";

const router = Router();

const SITE_BASE = "https://themoviebox.org";

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

    let foundMovie = null;
    let foundSources = null;

    for (const movie of results.filter((r) => r.hasResource)) {
      const movieboxUrl = buildMovieboxUrl(
        movie.detailPath,
        movie.subjectId,
        movie.subjectType,
        season,
        episode,
      );
      req.log.info({ url: movieboxUrl }, "Trying URL for streams");
      const sources = await resolveStreams(movieboxUrl);
      if (sources.length) {
        foundMovie = movie;
        foundSources = sources;
        break;
      }
    }

    if (!foundSources || !foundMovie) {
      res.status(502).json({
        error: "Could not fetch streams for this title.",
        hint: "Try omitting season/episode to get the default, or check the title spelling.",
        query,
        season,
        episode,
      });
      return;
    }

    const movieboxUrl = buildMovieboxUrl(
      foundMovie.detailPath,
      foundMovie.subjectId,
      foundMovie.subjectType,
      season,
      episode,
    );

    const streams = foundSources
      .filter((s) => !s.isHLS)
      .map((s) => {
        const playerUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(s.embedUrl)}`;
        return {
          name: s.name,
          originalUrl: s.embedUrl,
          playerUrl,
          iframe: `<iframe src="${playerUrl}" width="100%" height="500" allowfullscreen frameborder="0" allow="autoplay; encrypted-media"></iframe>`,
        };
      });

    const hlsStreams = foundSources
      .filter((s) => s.isHLS)
      .map((s) => ({
        name: s.name,
        originalUrl: s.embedUrl,
        playerUrl: `${baseUrl}/api/proxy?url=${encodeURIComponent(s.embedUrl)}`,
      }));

    const primaryStream = streams[0] || hlsStreams[0] || null;

    res.json({
      query,
      requested: { season, episode },
      movie: {
        title: foundMovie.title,
        subjectId: foundMovie.subjectId,
        subjectType: foundMovie.subjectType,
        poster: foundMovie.poster,
        genre: foundMovie.genre,
        releaseDate: foundMovie.releaseDate,
        country: foundMovie.country,
        imdbRating: foundMovie.imdbRating,
        movieboxUrl,
      },
      playerUrl: primaryStream?.playerUrl || null,
      embedIframe: "iframe" in (primaryStream ?? {}) ? (primaryStream as { iframe: string }).iframe : null,
      streams,
      hls: hlsStreams,
    });
  } catch (err) {
    req.log.error({ err }, "Title stream error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
