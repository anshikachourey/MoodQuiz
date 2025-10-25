"use client";

import { useState, useRef } from "react";
import Image from "next/image";

type Mood = {
  valence: number; energy: number; focus: number; danceability: number; tempo_pref: number;
};

type Track = {
  id: string; title: string; artist: string; artwork?: string;
  previewUrl?: string; year?: number; explicit?: boolean; genre?: string; provider: "itunes";
};

type BuildResponse = {
  title: string;
  mood: Mood;
  count: number;
  tracks: Track[];
};

export default function Home() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<BuildResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState<number>(-1);

  const build = async () => {
    setError(null);
    setRes(null);
    setLoading(true);
    try {
      const r = await fetch("/api/build-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, size: 25, allowExplicit: false }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as BuildResponse;
      setRes(data);
      setCurrent(-1);
    } catch (e: any) {
      setError(`Failed: ${e.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  };
  function answersToPrompt(a: {key:string; value?:string}[]) {
    // Turn quiz selections into a single prompt string that our parser understands.
    const map: Record<string,string> = {};
    a.forEach(x => { map[x.key] = x.value || ""; });
  
    const bits = [];
    if (map.goal?.includes("Study")) bits.push("focus instrumental lofi");
    if (map.goal?.includes("Dance")) bits.push("upbeat dance pop");
    if (map.goal?.includes("Feel better")) bits.push("feel good pop upbeat");
    if (map.goal?.includes("feels")) bits.push("moody indie");
  
    if (map.era?.includes("90s")) bits.push("90s");
    if (map.era?.includes("80s")) bits.push("80s");
    if (map.era?.includes("60s/70s")) bits.push("70s 60s");
  
    if (map.region?.includes("Bollywood")) bits.push("bollywood hindi");
    if (map.region?.includes("Italian")) bits.push("italian soundtrack");
    if (map.region?.includes("Pahadi")) bits.push("pahadi folk indian");
  
    if (map.extras && map.extras !== "skip" && map.extras !== "unknown") bits.push(map.extras);
  
    return bits.join(" ").trim();
  }  
  const playAt = async (idx: number) => {
    if (!res) return;
    const t = res.tracks[idx];
    if (!t?.previewUrl) return;
    const a = audioRef.current;
    if (!a) return;
  
    setIsSwitching(true);
    try {
      // stop current playback before switching sources
      if (!a.paused) a.pause();
  
      a.src = t.previewUrl;
  
      // IMPORTANT: await play() and swallow the promise error (autoplay policies etc.)
      await a.play().catch(() => { /* ignore */ });
  
      setCurrent(idx);
    } finally {
      setIsSwitching(false);
    }
  };
  const togglePlayPause = async () => {
    const a = audioRef.current;
    if (!a) return;
  
    // If nothing selected yet but we have tracks, start from 0
    if (current < 0 && res?.tracks?.length) {
      await playAt(0);
      return;
    }
  
    if (a.paused) {
      await a.play().catch(() => { /* ignore */ });
    } else {
      a.pause();
    }
  };  
  const playNext = () => {
    if (!res) return;
    const next = current + 1;
    if (next < res.tracks.length) playAt(next);
  };
  const playPrev = () => {
    const prev = current - 1;
    if (prev >= 0) playAt(prev);
  };

  return (
    <main className="min-h-screen mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-bold mb-4">🎧 MoodQuiz</h1>
      <p className="text-sm text-gray-500 mb-4">
        Type how you feel. We’ll turn it into a playlist (iTunes previews).
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g., I'm mentally exhausted but a bit hopeful"
        className="w-full h-28 p-3 border rounded-md focus:outline-none focus:ring"
      />

      <div className="mt-3 flex gap-3">
        <button
          onClick={build}
          disabled={loading || !text.trim()}
          className="px-4 py-2 rounded-md bg-black text-white disabled:opacity-50"
        >
          {loading ? "Building…" : "Build Playlist"}
        </button>
        {res && (
          <div className="text-sm text-gray-600 self-center">
            {res.title} • {res.count} tracks
          </div>
        )}
      </div>

      {error && <div className="mt-3 text-red-600">{error}</div>}

      <section className="mt-6">
        {!res && !loading && (
          <div className="text-gray-500">Results will appear here.</div>
        )}
        {res && (
          <ul className="grid grid-cols-1 gap-3">
            {res.tracks.map((t, i) => (
              <li
                key={t.id}
                className={`flex gap-3 items-center p-2 border rounded-md ${i===current ? "bg-gray-50" : ""}`}
              >
                <div className="w-16 h-16 relative shrink-0">
                  {t.artwork ? (
                    <Image
                      src={t.artwork}
                      alt={t.title}
                      fill
                      className="object-cover rounded"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-gray-200 rounded" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-sm text-gray-600">{t.artist} {t.year ? `• ${t.year}` : ""}</div>
                </div>
                <button
                  onClick={() => playAt(i)}
                  className="px-3 py-1 rounded-md border text-sm"
                >
                  {i === current ? "Playing" : "Play"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Player controls */}
    {/* Player controls */}
    <section className="fixed bottom-4 left-0 right-0">
      <div className="mx-auto max-w-3xl px-4">
        <div className="flex items-center gap-3 rounded-md border bg-white p-3 shadow">
          <button
            onClick={playPrev}
            disabled={isSwitching || !res?.tracks?.length || current <= 0}
            className="px-3 py-2 border rounded-md text-sm disabled:opacity-50"
            aria-label="Previous"
          >
            ◀︎ Prev
          </button>

          <button
            onClick={togglePlayPause}
            disabled={isSwitching || !res?.tracks?.length}
            className="px-3 py-2 border rounded-md text-sm disabled:opacity-50"
            aria-label="Play or pause"
          >
            ⏯︎ {audioRef.current?.paused ? "Play" : "Pause"}
          </button>

          <button
            onClick={playNext}
            disabled={isSwitching || !res?.tracks?.length || current === res?.tracks.length - 1}
            className="px-3 py-2 border rounded-md text-sm disabled:opacity-50"
            aria-label="Next"
          >
            Next ▶︎
          </button>

          <audio ref={audioRef} onEnded={playNext} />

          {current >= 0 && res && (
            <div className="text-sm text-gray-700 ml-2 truncate">
              {res.tracks[current]?.title} — {res.tracks[current]?.artist}
            </div>
          )}
        </div>
      </div>
    </section>
    </main>
  );
}

