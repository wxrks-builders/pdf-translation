const store = require("../store");

// How long a step usually takes, from the last 60 days of delivered jobs: the translation
// (approved → its first file) and the design-kept PDF (layout started → its last PDF). Jobs of a
// similar size (half to twice the words) when there are three, else a per-word rate. The progress
// page says "usually about N min" beside the step at work, so a long step doesn't read as stuck;
// the link email says how soon the files come (routes/auth.js).
let timing = null;
async function timingSamples() {
  if (timing && Date.now() - timing.at < 10 * 60 * 1000) return timing.samples;
  const rows = await store.listDeliveredForTiming(new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString());
  const samples = rows.map((r) => {
    const times = (name) => r.timeline.filter((e) => e.event === name).map((e) => new Date(e.at).getTime());
    const approved = times("approved")[0];
    const firstFile = times("deliverable_stored")[0];
    const layoutStart = times("layout_started")[0];
    const lastPdf = times("layout_pdf_stored").pop();
    return {
      words: r.words,
      translate: approved && firstFile > approved ? (firstFile - approved) / 1000 : null,
      layout: layoutStart && lastPdf > layoutStart ? (lastPdf - layoutStart) / 1000 : null,
    };
  });
  timing = { at: Date.now(), samples };
  return samples;
}

function median(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

async function estimateFor(words) {
  if (!words) return null;
  const samples = await timingSamples();
  const pick = (key) => {
    const near = samples.filter((x) => x[key] != null && x.words >= words / 2 && x.words <= words * 2).map((x) => x[key]);
    if (near.length >= 3) return Math.round(median(near));
    const rates = samples.filter((x) => x[key] != null && x.words > 0).map((x) => x[key] / x.words);
    return rates.length >= 3 ? Math.max(20, Math.round(median(rates) * words)) : null;
  };
  return { translate: pick("translate"), layout: pick("layout") };
}

module.exports = { estimateFor };
