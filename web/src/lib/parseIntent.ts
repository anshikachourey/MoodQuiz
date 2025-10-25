// web/src/lib/parseIntent.ts
export type Facets = {
    decade?: { from: number; to: number };
    country?: string;           // "US", "IN", etc (for iTunes country)
    language?: string;          // "hindi", "english", "italian"...
    region?: string;            // "bollywood", "pahadi", "latin"
    genres: string[];           // ["lofi","indie","ghazal","instrumental"]
    artists: string[];          // ["ar rahman","kishore kumar"]
    themes: string[];           // ["cinematic","mafia","nostalgic","rain"]
  };
  
  const ARTIST_HINTS = [
    "ar rahman","kishore kumar","lata mangeshkar","arijit singh",
    "atif aslam","asha bhosle","sonu nigam","udit narayan",
    "kk","mohit chauhan","prateek kuhad","rafi","nino rota"
  ];
  
  const CHARACTER_MAP: Record<string, string[]> = {
    "michael corleone": ["nino rota","godfather theme","italian","cinematic","orchestral","dark jazz"],
    "mario puzo": ["godfather","nino rota","cinematic"],
  };
  
  const REGION_TOKENS: Record<string, { country?: string; language?: string; genres?: string[] }> = {
    bollywood: { country: "IN", language: "hindi", genres: ["bollywood","soundtrack","hindustani","ghazal","indian pop"] },
    hindi:     { country: "IN", language: "hindi", genres: ["bollywood","indian pop","ghazal"] },
    italian:   { country: "IT", language: "italian", genres: ["soundtrack","classical","cinematic"] },
    pahadi:    { country: "IN", language: "hindi", genres: ["folk","hindustani","instrumental"] },
    uttarakhand:{ country: "IN", language: "hindi", genres: ["folk","hindustani","instrumental"] },
  };
  
  const GENRE_TOKENS = ["lofi","indie","edm","pop","rock","acoustic","instrumental","ghazal","soundtrack","classical","ambient","folk","jazz"];
  
  function findDecade(text: string) {
    // “90s”, “1990s”, “in the 70s”
    const m1 = text.match(/\b(\d{2})0s\b/);        // 70s
    const m2 = text.match(/\b(19|20)(\d{2})s\b/);  // 1990s
    if (m2) {
      const y = parseInt(m2[1] + m2[2].slice(0,1) + "0", 10);
      return { from: y, to: y + 9 };
    }
    if (m1) {
      const tens = parseInt(m1[1], 10);
      const base = tens >= 0 && tens <= 29 ? 2000 + tens * 10 : 1900 + tens * 10;
      return { from: base, to: base + 9 };
    }
    // “in the 90s” words
    const m3 = text.match(/\b(the )?([5-9]0s)\b/); // the 90s
    if (m3) {
      const tens = parseInt(m3[2], 10);
      const base = 1900 + tens;
      return { from: base, to: base + 9 };
    }
    return undefined;
  }
  
  export function parseFacets(raw: string): Facets {
    const text = raw.toLowerCase();
    const f: Facets = { genres: [], artists: [], themes: [] };
  
    // decade
    const dec = findDecade(text);
    if (dec) f.decade = dec;
  
    // region/language/country
    for (const key of Object.keys(REGION_TOKENS)) {
      if (text.includes(key)) {
        const r = REGION_TOKENS[key];
        if (r.country)  f.country = r.country;
        if (r.language) f.language = r.language;
        if (r.genres)   f.genres.push(...r.genres);
      }
    }
  
    // artists
    ARTIST_HINTS.forEach(a => { if (text.includes(a)) f.artists.push(a); });
  
    // characters / cultural references
    for (const k of Object.keys(CHARACTER_MAP)) {
      if (text.includes(k)) f.themes.push(...CHARACTER_MAP[k]);
    }
  
    // genres in text
    GENRE_TOKENS.forEach(g => { if (text.includes(g)) f.genres.push(g); });
  
    // special scenic vibes
    if (text.includes("mountain") || text.includes("uttarakhand"))
      f.themes.push("folk","acoustic","ambient","rain","nature");
    if (text.includes("monsoon") || text.includes("rain"))
      f.themes.push("rain","ambient","lofi");
  
    // defaults
    if (!f.country && (f.language === "hindi" || f.genres.includes("bollywood"))) f.country = "IN";
  
    // de-dupe
    f.genres = [...new Set(f.genres)];
    f.artists = [...new Set(f.artists)];
    f.themes  = [...new Set(f.themes)];
    return f;
  }
  