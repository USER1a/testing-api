import { Router, type IRouter } from "express";

const router: IRouter = Router();

const API_BASE = "https://h5-api.aoneroom.com";
const SITE_BASE = "https://themoviebox.org";

export interface MovieResult {
  title: string;
  subjectId: string;
  subjectType: number;
  detailPath: string;
  movieboxUrl: string;
  poster: string;
  genre: string;
  releaseDate: string;
  country: string;
  imdbRating: string;
  hasResource: boolean;
}

export async function searchMovies(keyword: string): Promise<MovieResult[]> {
  const res = await fetch(`${API_BASE}/wefeed-h5api-bff/subject/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Origin: SITE_BASE,
      Referer: `${SITE_BASE}/`,
    },
    body: JSON.stringify({ keyword, page: 1, perPage: 10 }),
  });

  if (!res.ok) throw new Error(`Search API returned ${res.status}`);

  const json = (await res.json()) as {
    code: number;
    data: {
      items: Array<{
        subjectId: string;
        subjectType: number;
        title: string;
        detailPath: string;
        cover: { url: string };
        genre: string;
        releaseDate: string;
        countryName: string;
        imdbRatingValue: string;
        hasResource: boolean;
      }>;
    };
  };

  if (json.code !== 0) throw new Error("Search API error");

  return json.data.items.map((item) => {
    const movieboxUrl =
      `${SITE_BASE}/movies/${item.detailPath}` +
      `?id=${item.subjectId}&type=/movie/detail&detailSe=&detailEp=&lang=en`;

    return {
      title: item.title,
      subjectId: item.subjectId,
      subjectType: item.subjectType,
      detailPath: item.detailPath,
      movieboxUrl,
      poster: item.cover?.url || "",
      genre: item.genre || "",
      releaseDate: item.releaseDate || "",
      country: item.countryName || "",
      imdbRating: item.imdbRatingValue || "",
      hasResource: item.hasResource,
    };
  });
}

router.get("/search", async (req, res) => {
  const q = req.query["q"];
  if (!q || typeof q !== "string" || q.trim() === "") {
    res.status(400).json({ error: "Query parameter 'q' is required" });
    return;
  }

  try {
    const results = await searchMovies(q.trim());
    res.json({ query: q.trim(), results });
  } catch (err) {
    req.log.error({ err }, "Search error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
