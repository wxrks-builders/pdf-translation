import i18n from "./i18n";

// The tones a visitor can pick, carried out by a Sous-Chef agent in wxrks. The instructions
// each one sends live in server/services/tone.js; keep the keys in step. Each tone's name and
// hint are messages: tone.preset.<key>.label and .hint.
export const TONES = ["auto", "formal", "friendly", "marketing", "legal", "technical"].map((key) => ({ key }));

export const TONE_NOTE_MAX = 500;

export const toneLabel = (key) => i18n.t(`tone.preset.${TONES.some((t) => t.key === key) ? key : "auto"}.label`);
export const toneHint = (key) => i18n.t(`tone.preset.${TONES.some((t) => t.key === key) ? key : "auto"}.hint`);

// "Formal · “for teenagers”": the note is the visitor's own words, quoted the language's way.
export function toneLine(tone) {
  if (!tone) return null;
  const label = toneLabel(tone.preset);
  return tone.note ? i18n.t("tone.withNote", { label, note: tone.note }) : label;
}
