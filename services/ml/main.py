# services/ml/main.py
import os
import re
import csv
from collections import Counter, defaultdict
from typing import Dict, Tuple, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

# =========================
# Config
# =========================
MODEL_ID = os.getenv("EMOTION_MODEL", "j-hartmann/emotion-english-distilroberta-base")

# Path to your GitLab VAD file: columns = term,valence,arousal,dominance
GITLAB_VAD_PATH = os.getenv(
    "GITLAB_VAD_PATH",
    os.path.join(os.path.dirname(__file__), "data", "vad_gitlab.csv")
)

# =========================
# FastAPI app + schema
# =========================
app = FastAPI(title="MoodQuiz")

class TextIn(BaseModel):
    text: str

# =========================
# HuggingFace pipeline (lazy)
# =========================
_hf_pipeline = None

def get_pipeline():
    """Lazy-create HF emotion classifier. Returns None if transformers not available."""
    global _hf_pipeline
    if _hf_pipeline is not None:
        return _hf_pipeline
    try:
        from transformers import pipeline
        # top_k=None is the new way to get all scores (return_all_scores is deprecated)
        _hf_pipeline = pipeline("text-classification", model=MODEL_ID, top_k=None)
    except Exception:
        _hf_pipeline = None
    return _hf_pipeline

# =========================
# Emotion -> Music mapping (fallback / blend component)
# =========================
EMOTION_TO_MOOD: Dict[str, Dict[str, float]] = {
    "joy":        {"valence": 0.9,  "energy": 0.7, "focus": 0.4, "danceability": 0.7, "tempo_pref": 0.75},
    "love":       {"valence": 0.85, "energy": 0.6, "focus": 0.5, "danceability": 0.6, "tempo_pref": 0.65},
    "admiration": {"valence": 0.8,  "energy": 0.6, "focus": 0.6, "danceability": 0.5, "tempo_pref": 0.65},
    "surprise":   {"valence": 0.7,  "energy": 0.8, "focus": 0.4, "danceability": 0.6, "tempo_pref": 0.8},
    "anger":      {"valence": 0.1,  "energy": 0.9, "focus": 0.3, "danceability": 0.4, "tempo_pref": 0.85},
    "sadness":    {"valence": 0.1,  "energy": 0.2, "focus": 0.6, "danceability": 0.3, "tempo_pref": 0.35},
    "fear":       {"valence": 0.15, "energy": 0.6, "focus": 0.5, "danceability": 0.3, "tempo_pref": 0.6},
    "disgust":    {"valence": 0.2,  "energy": 0.5, "focus": 0.4, "danceability": 0.3, "tempo_pref": 0.55},
    "optimism":   {"valence": 0.8,  "energy": 0.6, "focus": 0.6, "danceability": 0.6, "tempo_pref": 0.65},
    "curiosity":  {"valence": 0.7,  "energy": 0.5, "focus": 0.7, "danceability": 0.5, "tempo_pref": 0.55},
    "nervous":    {"valence": 0.24, "energy": 0.79,"focus": 0.38,"danceability": 0.35,"tempo_pref": 0.65},
    "neutral":    {"valence": 0.5,  "energy": 0.5, "focus": 0.5, "danceability": 0.5, "tempo_pref": 0.5},
}
DEFAULT_MOOD = {"valence":0.5, "energy":0.5, "focus":0.5, "danceability":0.5, "tempo_pref":0.5}

def blend_moods(a: Dict[str,float], b: Dict[str,float], wa: float = 0.5) -> Dict[str,float]:
    """Linear blend of two mood dicts with weight 'wa' for 'a' (and 1-wa for 'b')."""
    wb = 1.0 - wa
    out = {}
    for k in DEFAULT_MOOD.keys():
        out[k] = round((a.get(k,0.5)*wa) + (b.get(k,0.5)*wb), 4)
    return out

# =========================
# VAD (GitLab phrases/terms) loader + matcher
#   File value range: [-1, 1] → normalize to [0, 1]
#   Longest-phrase-first n-gram matching (up to 4-grams)
# =========================
_word_re = re.compile(r"[a-z']+")  # keep apostrophes (I'm -> i'm)

def tokenize(text: str) -> List[str]:
    return [w.lower() for w in _word_re.findall(text.lower())]

_term_dict: Dict[str, Tuple[float,float,float]] = {}
_index_by_first: Dict[str, Dict[int, Dict[Tuple[str,...], Tuple[float,float,float]]]] = {}
_max_ngram = 4  # up to 4-word phrases

def _norm01(x: float) -> float:
    # Input in [-1, 1] → output in [0, 1]
    return max(0.0, min(1.0, (x + 1.0) / 2.0))

def load_gitlab_vad() -> None:
    """Load GitLab VAD lexicon once into memory."""
    global _term_dict, _index_by_first
    if _term_dict:
        return

    term_dict: Dict[str, Tuple[float,float,float]] = {}
    index_by_first: Dict[str, Dict[int, Dict[Tuple[str,...], Tuple[float,float,float]]]] = defaultdict(lambda: defaultdict(dict))

    path = GITLAB_VAD_PATH
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=',')
        # Expect headers: term,valence,arousal,dominance
        for row in reader:
            term_raw = (row.get("term") or "").strip().lower()
            if not term_raw:
                continue
            toks = tokenize(term_raw)
            if not toks:
                continue

            try:
                v = float(row["valence"])
                a = float(row["arousal"])
                d = float(row["dominance"])
            except Exception:
                continue

            v01 = _norm01(v); a01 = _norm01(a); d01 = _norm01(d)
            key = " ".join(toks)
            term_dict[key] = (v01, a01, d01)

            first = toks[0]
            L = len(toks)
            if L <= _max_ngram:
                index_by_first[first][L][tuple(toks)] = (v01, a01, d01)

    _term_dict = term_dict
    _index_by_first = index_by_first

def vad_from_text_gitlab(text: str) -> Optional[Tuple[float,float,float]]:
    """
    Longest-phrase-first n-gram scan up to _max_ngram.
    Prefer 4-gram matches over 3-gram, etc.
    Allow multiple matches; weight by frequency.
    Returns (V,A,D) in [0,1], or None if no matches.
    """
    load_gitlab_vad()
    toks = tokenize(text)
    n = len(toks)
    if n == 0:
        return None

    counts = Counter()   # matched term -> count
    matches: List[Tuple[str, Tuple[float,float,float]]] = []

    i = 0
    while i < n:
        matched = False
        first = toks[i]
        # try longest to shortest (4 down to 1)
        for L in range(min(_max_ngram, n - i), 0, -1):
            if first not in _index_by_first:
                break
            slice_t = tuple(toks[i:i+L])
            entry = _index_by_first[first][L].get(slice_t)
            if entry:
                term_key = " ".join(slice_t)
                counts[term_key] += 1
                matches.append((term_key, entry))
                i += L
                matched = True
                break
        if not matched:
            i += 1

    if not matches:
        return None

    # Weighted average by match count
    sum_w = 0
    sum_v = sum_a = sum_d = 0.0
    for term_key, (v,a,d) in matches:
        c = counts[term_key]
        sum_v += v * c
        sum_a += a * c
        sum_d += d * c
        sum_w += c

    if sum_w == 0:
        return None

    return (round(sum_v/sum_w, 4), round(sum_a/sum_w, 4), round(sum_d/sum_w, 4))

# =========================
# VAD -> Music mood conversion
# =========================
def music_mood_from_vad(v: float, a: float, d: float) -> Dict[str, float]:
    """
    Map psychology VAD to music mood:
      - valence -> valence
      - arousal -> energy (and drives tempo_pref)
      - focus   -> higher when arousal is lower, slightly boosted by dominance
      - danceability -> mix of arousal and positive valence
      - tempo_pref -> pass arousal through (0..1); downstream can map to BPM
    """
    valence = v
    energy = a
    focus = max(0.0, min(1.0, (1.0 - 0.7*a) + 0.2*d))                  # calm + confident -> focus
    danceability = max(0.0, min(1.0, 0.35 + 0.45*a + 0.20*max(0.0, v - 0.5)))
    tempo_pref = a  # convert to BPM later: bpm ≈ 40 + 140*tempo_pref
    return {
        "valence": round(valence,4),
        "energy": round(energy,4),
        "focus": round(focus,4),
        "danceability": round(danceability,4),
        "tempo_pref": round(tempo_pref,4),
    }

# =========================
# Routes
# =========================
@app.get("/")
def root():
    return {"ok": True, "service": "MoodQuiz", "endpoints": ["/ml/infer/text"]}

@app.post("/ml/infer/text")
async def infer_text(inp: TextIn) -> Dict:
    text = (inp.text or "").strip()
    if not text:
        return {"emotions": {}, "mood": DEFAULT_MOOD, "vad": None, "source":"default"}

    # A) Emotion probabilities from HF model
    emotions: Dict[str, float] = {}
    nlp = get_pipeline()
    if nlp is not None:
        try:
            scores = nlp(text)[0]  # list[{"label": "joy", "score": 0.8}, ...]
            emotions = { s["label"].lower(): float(s["score"]) for s in scores }
        except Exception:
            emotions = {}

    # A -> mood via weighted emotion mapping
    mood_from_emotions = {**DEFAULT_MOOD}
    if emotions:
        totalsum = sum(emotions.values()) or 1.0
        agg = {k:0.0 for k in DEFAULT_MOOD.keys()}
        for label, prob in emotions.items():
            mp = EMOTION_TO_MOOD.get(label)
            if not mp:
                continue
            for dim, val in mp.items():
                agg[dim] += prob * val
        for dim in agg:
            mood_from_emotions[dim] = round(agg[dim] / totalsum, 4)

    # B) VAD from GitLab term/phrase lexicon
    vad = vad_from_text_gitlab(text)
    mood_from_vad = None
    if vad:
        v, a, d = vad
        mood_from_vad = music_mood_from_vad(v, a, d)

    # C) Blend
    if mood_from_vad and emotions:
        # 40% emotions, 60% VAD — tune 'wa' as you like
        final_mood = blend_moods(mood_from_emotions, mood_from_vad, wa=0.4)
        source = "blend(emotions,VAD-gitlab)"
    elif mood_from_vad:
        final_mood = mood_from_vad
        source = "VAD-gitlab"
    elif emotions:
        final_mood = mood_from_emotions
        source = "emotions"
    else:
        final_mood = DEFAULT_MOOD
        source = "default"

    return {"emotions": emotions, "mood": final_mood, "vad": vad, "source": source}
