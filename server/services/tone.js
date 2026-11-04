/**
 * The tone a visitor picks for a translation, carried out by a Sous-Chef agent: wxrks's AI
 * tone and style settings (domain, audience, formality, tone, creativity, instructions), which
 * its AI pre-translation follows. Each job with a tone gets its own agent, made the default of
 * both of the job's wxrks projects, and deleted once the job is over.
 *
 * "auto" sends no agent: wxrks then works the context out from the file itself. Every failure
 * here is soft; the job translates without the tone and its timeline says so.
 */
const store = require("../store");
const wxrks = require("./wxrks");

const NOTE_MAX = 500;

// The field values are the ones the Sous-Chef form in app.wxrks.com offers.
const PRESETS = {
  auto: null,
  formal: {
    domain: "General",
    audience: "Professional readers",
    formality: "Formal",
    tone: "Professional",
    creativity: "2",
    userPrompt: "Formal and precise. Use the formal form of address where the language has one (vous, Sie, usted).",
  },
  friendly: {
    domain: "General",
    audience: "Everyday readers",
    formality: "Informal",
    tone: "Conversational",
    creativity: "3",
    userPrompt: "Warm, plain, and easy to read. Use the informal form of address where the language has one (tu, du).",
  },
  marketing: {
    domain: "Marketing",
    audience: "Customers",
    formality: "Neutral",
    tone: "Persuasive",
    creativity: "4",
    userPrompt: "Read like copy first written in the target language, with its own rhythm and idioms. Keep claims, prices, and numbers exactly as they are.",
  },
  legal: {
    domain: "Legal",
    audience: "Lawyers and the parties to a contract",
    formality: "Formal",
    tone: "Professional",
    creativity: "1",
    userPrompt: "Faithful and literal. Keep every defined term the same each time it appears. Don't simplify, summarize, or add anything.",
  },
  technical: {
    domain: "Technical documentation",
    audience: "Technical readers",
    formality: "Neutral",
    tone: "Technical",
    creativity: "2",
    userPrompt: "Clear and exact. Keep product names, units, code, and interface labels as they are.",
  },
};

// A typed note with no preset still needs every field the agent requires.
const BASE = { domain: "General", audience: "General readers", formality: "Neutral", tone: "Professional", creativity: "3", userPrompt: "" };

// From the upload form → { preset, note } or null for "no agent".
function parse(body) {
  const preset = Object.hasOwn(PRESETS, body?.tonePreset) ? body.tonePreset : "auto";
  const note = String(body?.toneNote || "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  if (preset === "auto" && !note) return null;
  return { preset, note: note || null };
}

function instructionsFor({ preset, note }) {
  const base = PRESETS[preset] || BASE;
  const userPrompt = [base.userPrompt, note].filter(Boolean).join("\n\n");
  return { ...base, userPrompt, guideline: null };
}

async function apply(jobId, project) {
  const job = await store.getJob(jobId);
  if (!job?.tone) return;
  try {
    let agentUuid = job.tone_agent_uuid;
    if (!agentUuid) {
      const agent = await wxrks.createAgent({
        name: `translate-${job.id}`,
        description: "translate.wxrks.com: the tone for one job, deleted when the job ends",
        accountUuid: project.accountUuid,
        aiInstructions: instructionsFor(job.tone),
        projectUuid: project.uuid,
      });
      agentUuid = agent.uuid;
      await store.updateJob(job.id, { tone_agent_uuid: agentUuid });
    }
    await wxrks.setProjectAgent({ projectUuid: project.uuid, accountUuid: project.accountUuid, agentUuid });
    await store.appendJobEvent(job.id, "tone_applied", { preset: job.tone.preset, project: project.uuid });
  } catch (err) {
    console.warn(`[tone] job ${jobId}: ${wxrks.errInfo(err)}`);
    await store.appendJobEvent(jobId, "tone_failed", { error: wxrks.errInfo(err).slice(0, 200) });
  }
}

async function release(jobId) {
  const job = await store.getJob(jobId);
  if (!job?.tone_agent_uuid) return;
  try {
    await wxrks.deleteAgent(job.tone_agent_uuid);
    await store.updateJob(job.id, { tone_agent_uuid: null });
  } catch (err) {
    console.warn(`[tone] job ${jobId}: agent ${job.tone_agent_uuid} not deleted: ${wxrks.errInfo(err)}`);
  }
}

module.exports = { PRESETS, NOTE_MAX, parse, instructionsFor, apply, release };
