// web/src/app/api/build-playlist/route.ts
import { NextRequest, NextResponse } from "next/server";
import ky from "ky";
import { parseFacets } from "@/lib/parseIntent";

type Mood = {
  valence: number;
  energy: number;
  focus: number;
  danceability: number;
  tempo_pref: number;
};

type BuildRequest = {
  text: string;
  size?: number;
  allowExplicit?: boolean;
};

const ML_BASE = process.env.NEXT_PUBLIC_ML_BASE || "http://127.0.0.1:8001";
const DEFAULT_COUNTRY = process.env.ITUNES_COUNTRY || "US";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BuildRequest;
    const text = (body.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }
    const size = Math.min(Math.max(body.size ?? 25, 5), 50);
    const allowExplicit = !!body.allowExplicit;

    // 1) Mood from ML service
    const ml = await ky
      .post(`${ML_BASE}/ml/infer/text`, { json: { text } })
      .json<{ mood: Mood }>();
    const mood = ml.mood;

    // 2) Facets (era/region/artist/genre/theme)
    const facets = parseFacets(text);
    const country = facets.country || DEFAULT_COUNTRY;
    const decade = facets.decade; // {from,to} | undefined

    // 3) Build facet-aware queries
    const queries = buildFacetQueries(text, mood, facets);

    // 4) Fetch candidates across primary + helpful fallbacks
    const countries = [country, "US", "IN"];
    const raw: any[] = [];
    const seenIds = new Set<number>();

    for (const c of countries) {
      for (const q of queries) {
        const batch = await searchItunesFacetAware(q, c);
        for (const r of batch) {
          if (!r.previewUrl) continue; // need a 30s preview we can play
          if (!allowExplicit && r.trackExplicitness === "explicit") continue;
          if (seenIds.has(r.trackId)) continue;

          // decade filter when requested
          const y = r.releaseDate ? new Date(r.releaseDate).getFullYear() : undefined;
          if (decade && y && (y < decade.from || y > decade.to)) continue;

          seenIds.add(r.trackId);
          raw.push(r);
        }
        if (raw.length > 600) break;
      }
      if (raw.length > 600) break;
    }

    // 5) Map → Track objects
    const tracks = raw.map((r) => ({
      id: `itunes:${r.trackId}`,
      title: r.trackName,
      artist: r.artistName,
      artwork: r.artworkUrl100?.replace("100x100", "300x300") || r.artworkUrl100,
      previewUrl: r.previewUrl,
      year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : undefined,
      explicit: r.trackExplicitness === "explicit",
      genre: r.primaryGenreName,
      provider: "itunes" as const,
    }));

    if (tracks.length === 0) {
      return NextResponse.json(
        {
          title: makeTitleFromText(text, mood),
          mood,
          count: 0,
          tracks: [],
          note:
            "No previewable results matched. Try adding a genre/region (e.g., '90s bollywood rain', 'italian cinematic nino rota').",
        },
        { status: 200 }
      );
    }

    // 6) Score, diversify, slice
    const scored = tracks
      .map((t) => ({ t, score: scoreByHeuristics(mood, t) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.t);

    const diversified = diversify(scored, 2).slice(0, size);

    return NextResponse.json(
      {
        title: makeTitleFromText(text, mood),
        mood,
        count: diversified.length,
        tracks: diversified,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to build playlist", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}

/* ---------------- helpers ---------------- */

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function bpmFromMood(m: Mood) {
  return Math.round(40 + 140 * clamp01(m.tempo_pref)); // ~40..180
}

function buildFacetQueries(
  text: string,
  mood: Mood,
  f: ReturnType<typeof parseFacets>
) {
  const vibe: string[] = [];
  const bpm = bpmFromMood(mood);
  if (bpm <= 95) vibe.push("chill", "acoustic", "ambient", "lofi");
  else if (bpm <= 115) vibe.push("indie", "mellow");
  else if (bpm <= 135) vibe.push("pop", "upbeat");
  else vibe.push("dance", "edm");

  const decadeTerm = f.decade ? `${f.decade.from}-${f.decade.to}` : "";
  const lang = f.language ? f.language : "";
  const region = f.region ? f.region : "";
  const g = f.genres.join(" ");
  const th = f.themes.join(" ");
  const artists = f.artists;

  const q: string[] = [];
  if (artists.length) q.push(`${artists[0]} ${g} ${th} ${decadeTerm}`);
  q.push(`${region} ${lang} ${g} ${th} ${decadeTerm}`.trim());
  q.push(`${g} ${th}`.trim());
  q.push(vibe.join(" "));
  q.push(text.slice(0, 60).replace(/[^\w\s]/g, ""));

  // de-dupe, trim empties
  return [...new Set(q.filter(Boolean).map((s) => s.replace(/\s+/g, " ").trim()))];
}

async function searchItunesFacetAware(term: string, country: string) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "200");
  url.searchParams.set("country", country);
  try {
    const resp = await ky.get(url.toString()).json<any>();
    return resp.results || [];
  } catch {
    return [];
  }
}

// light heuristic since we don't have audio features
function scoreByHeuristics(mood: Mood, t: any) {
  let s = 0;
  const g = (t.genre || "").toLowerCase();
  const title = `${t.title} ${t.artist}`.toLowerCase();

  // valence / energy proxies
  if (g.includes("dance") || g.includes("pop")) s += mood.valence * 0.6 + mood.energy * 0.4;
  if (g.includes("ambient") || g.includes("lofi") || g.includes("classical"))
    s += (1 - mood.energy) * 0.7;

  // focus proxy
  if (title.includes("instrumental")) s += mood.focus * 0.8;

  // age tilt
  const y = t.year || 0;
  if (y) {
    s += (y >= 2018 ? 0.15 : 0) * mood.energy;
    s += (y <= 2010 ? 0.1 : 0) * mood.focus;
  }

  if (title.includes("remix")) s += mood.danceability * 0.3;
  return s;
}

function diversify(tracks: any[], perArtistCap = 2) {
  const seen = new Map<string, number>();
  const out: any[] = [];
  for (const t of tracks) {
    const a = (t.artist || "unknown").toLowerCase();
    const n = seen.get(a) ?? 0;
    if (n < perArtistCap) {
      out.push(t);
      seen.set(a, n + 1);
    }
  }
  return out;
}

function makeTitleFromText(text: string, mood: Mood) {
  const bpm = bpmFromMood(mood);
  const vibe =
    mood.energy > 0.65 ? "Upbeat" :
    mood.focus  > 0.6  ? "Focus"  :
    mood.valence< 0.35 ? "Moody"  : "Mellow";
  return `${vibe} • ~${bpm} BPM`;
}

