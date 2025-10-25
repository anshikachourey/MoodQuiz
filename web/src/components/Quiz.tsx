"use client";
import { useState } from "react";

type Answer = { key: string; value?: string };

const QUESTIONS = [
  {
    id: "goal",
    title: "What do you want right now?",
    choices: ["Vibe/Study", "Dance/Energize", "Feel better", "Feel the feels"],
  },
  {
    id: "era",
    title: "Any era in mind?",
    choices: ["No preference", "60s/70s", "80s", "90s", "2000s", "2010s", "2020s+"],
  },
  {
    id: "region",
    title: "Language / region?",
    choices: ["No preference", "Bollywood/Hindi", "English/US-UK", "Italian", "Pahadi/Indian Folk"],
  },
  {
    id: "extras",
    title: "Anything else? (genre/artist/scene)",
    choices: ["Lofi/Instrumental", "Indie/Acoustic", "EDM/Pop", "Ghazal/Soundtrack"],
    allowText: true,
  },
];

export default function Quiz({ onDone }: { onDone: (answers: Answer[]) => void }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [custom, setCustom] = useState("");

  const q = QUESTIONS[i];

  function pick(choice?: string) {
    const a: Answer = { key: q.id, value: choice };
    if (q.id === "extras" && custom.trim()) a.value = `${choice ?? ""} ${custom}`.trim();
    setAnswers(prev => {
      const rest = prev.filter(x => x.key !== q.id);
      return [...rest, a];
    });
    if (i < QUESTIONS.length - 1) setI(i + 1);
    else onDone(answers.concat(a));
    setCustom("");
  }

  return (
    <div className="rounded-md border p-3">
      <div className="text-sm text-gray-500 mb-1">Question {i+1} of {QUESTIONS.length}</div>
      <div className="font-semibold mb-3">{q.title}</div>

      <div className="flex flex-wrap gap-2 mb-3">
        {q.choices.map(c => (
          <button key={c}
            onClick={() => pick(c)}
            className="px-3 py-2 text-sm rounded-md border hover:bg-gray-50">
            {c}
          </button>
        ))}
        <button onClick={() => pick("skip")}
          className="px-3 py-2 text-sm rounded-md border hover:bg-gray-50">
          I don’t feel like answering
        </button>
        <button onClick={() => pick("unknown")}
          className="px-3 py-2 text-sm rounded-md border hover:bg-gray-50">
          I don’t know
        </button>
      </div>

      {q.allowText && (
        <div className="flex gap-2">
          <input value={custom} onChange={e=>setCustom(e.target.value)}
            placeholder="Type your own (e.g., 90s bollywood rain)"
            className="flex-1 px-3 py-2 border rounded-md"/>
          <button onClick={() => pick()}
            className="px-3 py-2 rounded-md border">
            Add
          </button>
        </div>
      )}
    </div>
  );
}
