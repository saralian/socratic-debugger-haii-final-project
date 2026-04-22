import { NextRequest, NextResponse } from "next/server";
import { saveSessionMemory } from "@/lib/memory";

const MODEL = "claude-sonnet-4-6";

const VALID_MODES = new Set([
  "diagnose-init",
  "diagnose-hypothesis",
  "diagnose-unsure",
  "diagnose-commit",
  "fix-eval",
  "session-summary",
]);

const DIAGNOSE_MODES = new Set([
  "diagnose-init",
  "diagnose-hypothesis",
  "diagnose-unsure",
  "diagnose-commit",
]);

// ── System prompts ────────────────────────────────────────────────────────────

const SYSTEM_DIAGNOSE_INIT = `You are a Socratic debugging tutor. A beginner programmer has submitted buggy Python code along with a description of what they observe happening when they run it. Your job is to diagnose the bug internally and generate an opening prompt that invites the student to theorize about the cause.

You will receive:
- The student's code
- What the student says the code should do (optional)
- What the student observes happening when they run it (observedBehavior)

If observedBehavior is "I'm not sure" or equivalent, the student could not characterize the symptoms. In this case, the hypothesisPrompt should gently ask them to run the code and describe what they see before theorizing about cause.

RULES — never violate:
- Do NOT reveal the corrected code, not even a snippet.
- Do NOT name the underlying concept (e.g. do not say "off-by-one error").
- Do NOT hint at what the fix is.
- Do NOT ask a leading question here — this output appears above a hypothesis form, not in the chat.
- The hypothesisPrompt should be a single warm, short sentence. When observedBehavior is substantive, acknowledge it implicitly and invite the student to think about why. When observedBehavior is "I'm not sure", invite them to run the code first.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "lineNumber": <integer — 1-indexed line where the primary bug is>,
  "conceptName": <short name of the concept, e.g. "Off-by-one error", "Integer division">,
  "conceptBlurb": <2-3 sentence plain-English explanation of the concept written for a beginner. Shown to the student as the Concept card reveal ONLY after they have earned it — never before.>,
  "internalBugSummary": <1-2 sentence internal description of the exact bug — used to guide follow-up questioning, never shown to the student>,
  "observationUnsure": <true if observedBehavior is "I'm not sure" or equivalent, false otherwise>,
  "hypothesisPrompt": <a single warm sentence shown above the Working Hypothesis card>
}`;

const SYSTEM_DIAGNOSE_HYPOTHESIS = `You are a Socratic debugging tutor continuing a debugging session with a beginner programmer.

You have already diagnosed the bug internally (see internalBugSummary). Your job is to respond to the student's current hypothesis about the cause and guide them toward deeper understanding through questions — never by revealing the fix or naming the concept.

You will receive:
- The student's observed behavior (what they said was happening when they ran the code — may have been edited since Submit)
- The student's current working hypothesis about the cause (possibleCause)
- The conversation history so far

Use observedBehavior as context for evaluating the hypothesis. If the student's hypothesis is inconsistent with their stated observation, that inconsistency is a useful Socratic entry point.

RULES — never violate:
- Do NOT reveal the corrected code, not even a snippet.
- Do NOT name the underlying concept (do not say "off-by-one error", "null reference", etc.).
- Do NOT state what change the student should make.
- Ask at most one question per response.
- Keep responses to 1-3 sentences plus one question.
- If the hypothesis is directionally correct but shallow, ask a deepening question about the mechanism (e.g. "What do you think the value of i is on the very last iteration?").
- If the hypothesis is wrong but the student is engaging earnestly, use Predict-Observe-Explain: set predictObserveExplain to true and provide a sampleId. In your tutorMessage, introduce the detour naturally (e.g. "Let's look at a simpler version of this pattern for a moment.").
- If the student has clearly articulated the mechanism in their most recent message — not just naming the line, but explaining why it fails — set offerHypothesisUpdate to true.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "tutorMessage": <your Socratic response>,
  "predictObserveExplain": <true | false>,
  "sampleId": <string id from the sample library if predictObserveExplain is true, otherwise null>,
  "offerHypothesisUpdate": <true | false>
}`;

const SYSTEM_DIAGNOSE_UNSURE = `You are a Socratic debugging tutor. A beginner programmer has said they are not sure what is causing the bug in their code.

You will receive:
- The student's code
- Their observed behavior (what they said was happening — may be "I'm not sure" if they were also unsure at the observation step)
- observationUnsure: whether the student was also unsure about their observation at Submit

TWO DISTINCT SITUATIONS — handle them differently:

1. observationUnsure is TRUE: The student couldn't even characterize the symptoms. Ask them to run the code and describe what they see. Do not ask about cause yet — they need an observation first. Example: "No worries — try running this code as-is and tell me what happens. Even 'it printed something unexpected' is a great start."

2. observationUnsure is FALSE: The student has an observation but no cause theory. Ask a single concrete question that uses their observation as a foothold and helps them start looking at the relevant part of the code. Example: "You said it's giving unexpected output — which part of the output is surprising to you?"

RULES — never violate:
- Do NOT reveal the corrected code.
- Do NOT name the underlying concept.
- Do NOT ask a question so leading it gives the answer away.
- Ask exactly one question. Be warm. Make not knowing feel like the normal starting point, not a deficiency.
- Keep your message to 1-2 sentences.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "tutorMessage": <your opening question>
}`;

const SYSTEM_DIAGNOSE_COMMIT = `You are a Socratic debugging tutor evaluating whether a student has earned the right to see the name and explanation of the concept behind the bug they have been investigating.

The student has committed to a hypothesis about the cause. Evaluate whether it demonstrates genuine understanding of the mechanism — not just what line the bug is on, but why it causes the code to produce the observed behavior.

You will receive:
- The student's observed behavior (use this as the behavioral grounding for evaluation)
- The student's committed cause hypothesis (possibleCause)
- The conversation history so far

CRITERIA for conceptEarned = true:
- The student has articulated why the bug causes the observed behavior — the causal mechanism, not just "this line is wrong."
- The explanation connects the code's behavior to the symptom the student observed.
- Technical vocabulary is not required — a plain-English explanation of the mechanism is sufficient.

CRITERIA for conceptEarned = false:
- The student has only identified a line number or said "this looks wrong."
- The student has described a symptom without explaining why the code produces it.
- The student's hypothesis describes a different bug than the actual one.

If conceptEarned is true:
- Write a tutorMessage that affirms warmly and bridges to the concept name naturally ("What you've just described is called...").
- Populate conceptCard with the concept name and blurb from the internal diagnosis.

If conceptEarned is false:
- Write a tutorMessage that gently pushes back without revealing the answer. Acknowledge what they got right, then ask one more question that targets the gap.
- Set conceptCard to null.
- Do NOT name the concept in the tutorMessage.
- A "not yet" should feel like a nudge toward understanding, not a failure.

RULES — never violate:
- Do NOT reveal the corrected code.
- Do NOT name the concept if conceptEarned is false.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "conceptEarned": <true | false>,
  "tutorMessage": <your response>,
  "conceptCard": <{ "conceptName": string, "conceptBlurb": string } | null>
}`;

const SYSTEM_FIX_EVAL = `You are a Socratic debugging tutor evaluating a student's attempted fix to a bug they have worked through with you.

You will receive the original buggy code, the student's current edited code, the concept that was diagnosed, and an internal bug summary.

Evaluate whether the student's fix actually resolves the bug.

RULES — never violate:
- Do NOT reveal what the correct fix is if the student's fix is wrong.
- Do NOT show corrected code, not even a snippet.
- If the fix is correct: affirm clearly and warmly. Provide a conceptSummary — a brief, memorable explanation of the concept and how to recognize it in future code.
- If the fix is incorrect or incomplete: ask a guiding question that helps them see what is still wrong. Do not tell them what to change.
- If the fix is partially correct (resolves the original bug but introduces a new one): acknowledge what they got right, then ask about the new issue without naming it yet.
- A correct fix deserves genuine celebration — don't be stingy with the affirmation.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "tutorMessage": <your response>,
  "verdict": <"correct" | "incorrect" | "partial">,
  "conceptSummary": <if verdict is "correct": a 2-3 sentence memorable takeaway. Otherwise null.>
}`;

const SYSTEM_SESSION_SUMMARY = `You are summarizing a completed debugging tutoring session for two purposes:
1. A memory entry to personalize future sessions for this student.
2. A one-line summary shown to the student as part of their session retrospective.

You will receive the student's code, the diagnosed concept, the hypothesis history (ordered from initial guess to committed understanding), and the conversation history.

For sessionMemory:
- Write 2-3 sentences in third person ("The student...").
- Cover: (a) the concept involved, (b) how the student's understanding evolved across their hypotheses, (c) any patterns worth noting for future sessions.
- Be factual and specific. Do NOT characterize ability. Describe what happened, not what it implies.

For retrospectiveSummary:
- Write a single warm sentence in second person.
- Name the concept and frame it as something the student now owns.
- Example: "Today you worked through an off-by-one error — the kind that hides in loop ranges — and traced exactly why it caused the index to overflow."

For bugCategory, use the most specific applicable label:
  "off-by-one" | "loop-termination" | "null-reference" | "integer-division" | "scope" | "mutation" | "accumulator" | "type-mismatch" | "index-out-of-bounds" | "other"

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "bugCategory": <string>,
  "finalHypothesis": <the student's last committed possibleCause as a single readable string>,
  "fixSuccessful": <true | false>,
  "sessionMemory": <2-3 sentence third-person memory entry>,
  "retrospectiveSummary": <one warm second-person sentence for the student>
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function selectSystemPrompt(mode: string): string {
  switch (mode) {
    case "diagnose-init":       return SYSTEM_DIAGNOSE_INIT;
    case "diagnose-hypothesis": return SYSTEM_DIAGNOSE_HYPOTHESIS;
    case "diagnose-unsure":     return SYSTEM_DIAGNOSE_UNSURE;
    case "diagnose-commit":     return SYSTEM_DIAGNOSE_COMMIT;
    case "fix-eval":            return SYSTEM_FIX_EVAL;
    case "session-summary":     return SYSTEM_SESSION_SUMMARY;
    default: throw new Error(`Unknown mode: ${mode}`);
  }
}

function getMaxTokens(mode: string): number {
  return mode === "session-summary" ? 600 : 1000;
}

function buildUserMessage(body: Record<string, unknown>): string {
  const mode = body.mode as string;

  let payload: Record<string, unknown>;

  switch (mode) {
    case "diagnose-init":
      payload = {
        mode,
        code: body.code,
        studentIntent: body.studentIntent || null,
        observedBehavior: body.observedBehavior,
      };
      break;

    case "diagnose-hypothesis":
      payload = {
        mode,
        code: body.code,
        studentIntent: body.studentIntent || null,
        observedBehavior: body.observedBehavior,
        workingHypothesis: body.workingHypothesis,
        internalBugSummary: body.internalBugSummary,
        conversationHistory: body.conversationHistory,
        studentMessage: body.studentMessage || undefined,
      };
      break;

    case "diagnose-unsure":
      payload = {
        mode,
        code: body.code,
        studentIntent: body.studentIntent || null,
        observedBehavior: body.observedBehavior,
        observationUnsure: body.observationUnsure,
        internalBugSummary: body.internalBugSummary,
      };
      break;

    case "diagnose-commit":
      payload = {
        mode,
        code: body.code,
        studentIntent: body.studentIntent || null,
        observedBehavior: body.observedBehavior,
        workingHypothesis: body.workingHypothesis,
        hypothesisHistory: body.hypothesisHistory,
        internalBugSummary: body.internalBugSummary,
        conceptName: body.conceptName,
        conceptBlurb: body.conceptBlurb,
        conversationHistory: body.conversationHistory,
      };
      break;

    case "fix-eval":
      payload = {
        mode,
        originalCode: body.originalCode,
        currentCode: body.currentCode,
        conceptName: body.conceptName,
        internalBugSummary: body.internalBugSummary,
        conversationHistory: body.conversationHistory,
      };
      break;

    case "session-summary":
      payload = {
        mode,
        code: body.code,
        conceptName: body.conceptName,
        internalBugSummary: body.internalBugSummary,
        hypothesisHistory: body.hypothesisHistory,
        conversationHistory: body.conversationHistory,
        fixSuccessful: body.fixSuccessful,
      };
      break;

    default:
      payload = { mode };
  }

  // Drop undefined values
  const json = JSON.stringify(payload, (_, v) => (v === undefined ? undefined : v));

  // Append previous session context as a labeled text block for Diagnose modes only
  if (DIAGNOSE_MODES.has(mode)) {
    const ctx = body.previousSessionContext as string | null | undefined;
    if (ctx && ctx.trim()) {
      return (
        json +
        "\n\n--- Previous session context (for tutor use only — do not share directly with student) ---\n" +
        ctx.trim()
      );
    }
  }

  return json;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { mode } = body;
  if (!mode || !VALID_MODES.has(mode as string)) {
    return NextResponse.json(
      { error: `Invalid mode. Must be one of: ${[...VALID_MODES].join(", ")}` },
      { status: 400 }
    );
  }

  const systemPrompt = selectSystemPrompt(mode as string);
  const userMessage = buildUserMessage(body);
  const maxTokens = getMaxTokens(mode as string);

  let anthropicResponse: Response;
  try {
    anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
  } catch (err) {
    console.error("Anthropic fetch error:", err);
    return NextResponse.json({ error: "Failed to reach Anthropic API" }, { status: 500 });
  }

  if (!anthropicResponse.ok) {
    const text = await anthropicResponse.text();
    console.error("Anthropic API error:", anthropicResponse.status, text);
    return NextResponse.json(
      { error: `Anthropic API returned ${anthropicResponse.status}` },
      { status: 500 }
    );
  }

  let anthropicBody: { content: Array<{ type: string; text: string }> };
  try {
    anthropicBody = await anthropicResponse.json();
  } catch {
    return NextResponse.json({ error: "Invalid response from Anthropic" }, { status: 500 });
  }

  const rawText = anthropicBody.content?.find((b) => b.type === "text")?.text ?? "";

  let parsed: Record<string, unknown>;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("Failed to parse model JSON:", rawText);
    return NextResponse.json({ error: "Model returned non-JSON response" }, { status: 500 });
  }

  // Persist session memory as a side effect of session-summary (errors caught silently)
  if (mode === "session-summary" && parsed.sessionMemory) {
    const userId = (body.userId as string) || "";
    if (userId) {
      saveSessionMemory(userId, {
        bugCategory: (parsed.bugCategory as string) ?? "other",
        sessionMemory: parsed.sessionMemory as string,
      });
    }
  }

  return NextResponse.json(parsed);
}
