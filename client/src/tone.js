// The tones a visitor can pick, carried out by a Sous-Chef agent in wxrks. The instructions
// each one sends live in server/services/tone.js; keep the keys in step.
export const TONES = [
  { key: "auto", label: "Automatic", hint: "Sous-Chef reads your document and matches its tone." },
  { key: "formal", label: "Formal", hint: "Formal and precise, with the formal “you” where the language has one." },
  { key: "friendly", label: "Friendly", hint: "Warm and plain, with the informal “you” where the language has one." },
  { key: "marketing", label: "Marketing", hint: "Reads like copy written in the language. Claims and numbers stay exact." },
  { key: "legal", label: "Legal", hint: "Faithful and literal. Defined terms stay the same every time." },
  { key: "technical", label: "Technical", hint: "Clear and exact. Product names, units, and code stay as they are." },
];

export const TONE_NOTE_MAX = 500;

export function toneLine(tone) {
  if (!tone) return null;
  const label = TONES.find((t) => t.key === tone.preset)?.label || "Automatic";
  return tone.note ? `${label} · “${tone.note}”` : label;
}
