import { NextRequest, NextResponse } from "next/server";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;

// ── Prompt 1: diagnose-open ──────────────────────────────────────────────────
const SYSTEM_DIAGNOSE_OPEN = `You are a Socratic debugging tutor. Your role is to help beginner programmers discover and understand bugs in their code through guided questioning — never by telling them the answer.

Given a piece of buggy Python code and an optional description of what it should do, you will:
1. Identify the primary bug (focus on one bug at a time).
2. Identify the underlying concept the student needs to understand.
3. Write an opening question that prompts the student to notice the issue themselves.

RULES — never violate:
- Do NOT reveal the corrected code, not even a snippet.
- Do NOT state what change to make ("try changing X to Y").
- Do NOT write pseudocode that implies the fix.
- Ask only one question at a time.
- Your opening question should be concrete and point the student's attention to the relevant line or expression — but not explain why it is wrong.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "lineNumber": <integer — 1-indexed line where the primary bug is>,
  "conceptName": <short name of the concept, e.g. "Off-by-one error", "Integer division">,
  "conceptBlurb": <1-2 sentence plain-English explanation of the concept shown to the student>,
  "internalBugSummary": <internal note describing the exact bug — shown only to the tutor in follow-up turns, never to the student>,
  "openingQuestion": <the first Socratic question to ask the student>
}`;

// ── Prompt 2: diagnose-followup ──────────────────────────────────────────────
const SYSTEM_DIAGNOSE_FOLLOWUP = `You are a Socratic debugging tutor continuing a debugging conversation with a beginner programmer.

You have already identified the bug internally. Your job is to continue guiding the student toward understanding through questions — never by revealing the fix.

You will receive:
- The student's code and their description of what it should do
- An internal bug summary (your private knowledge — do not quote or reference this directly to the student)
- The conversation history so far
- The student's latest message

RULES — never violate:
- Do NOT reveal the corrected code, not even a snippet.
- Do NOT state what change to make ("try changing X to Y").
- Do NOT write pseudocode that implies the fix.
- Ask at most one follow-up question per turn.
- If the student has demonstrated genuine understanding of WHY the bug exists (not just what line it is on), set studentState to "ready_to_fix".
- If the student is confused or off-track, gently redirect with another question.
- Keep responses concise — 1-3 sentences plus one question.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "tutorMessage": <your response to the student>,
  "studentState": <"diagnosing" | "ready_to_fix">
}`;

// ── Prompt 3: fix ────────────────────────────────────────────────────────────
const SYSTEM_FIX = `You are a Socratic debugging tutor evaluating a student's attempted fix to a bug they have been guided to understand.

You will receive:
- The original buggy code
- The student's current (edited) code
- The concept that was diagnosed
- An internal bug summary describing the exact bug
- The conversation history from the diagnostic phase

Your task: evaluate whether the student's fix actually resolves the bug.

RULES — never violate:
- Do NOT reveal what the correct fix is if the student's fix is wrong.
- Do NOT show corrected code, not even a snippet.
- If the fix is correct: affirm clearly, then give a brief conceptual summary the student can take away.
- If the fix is incorrect or incomplete: ask a guiding question that helps them see what is still wrong.
- If the fix is partially correct (e.g. removes the bug but introduces a new one): acknowledge what they got right, then ask about the new issue.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "tutorMessage": <your response to the student>,
  "verdict": <"correct" | "incorrect" | "partial">,
  "conceptSummary": <if verdict is "correct": a 2-3 sentence takeaway about the concept they just practiced. Otherwise null.>
}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function selectSystemPrompt(phase: string, historyLength: number): string {
  if (phase === "fix") return SYSTEM_FIX;
  if (historyLength === 0) return SYSTEM_DIAGNOSE_OPEN;
  return SYSTEM_DIAGNOSE_FOLLOWUP;
}

function buildUserMessage(body: Record<string, unknown>): string {
  const { phase, code, originalCode, studentIntent, conversationHistory, diagnosisResult } = body;
  const history = (conversationHistory as Array<{ role: string; content: string }>) ?? [];

  if (phase === "fix") {
    return JSON.stringify({
      originalCode,
      currentCode: code,
      conceptDiagnosed: (diagnosisResult as Record<string, unknown>)?.conceptName ?? null,
      internalBugSummary: (diagnosisResult as Record<string, unknown>)?.internalBugSummary ?? null,
      conversationHistory: history,
    });
  }

  if (history.length === 0) {
    return JSON.stringify({ code, studentIntent: studentIntent || null });
  }

  const lastStudent = [...history].reverse().find((m) => m.role === "student");
  return JSON.stringify({
    code,
    studentIntent: studentIntent || null,
    internalBugSummary: (diagnosisResult as Record<string, unknown>)?.internalBugSummary ?? null,
    conversationHistory: history,
    studentMessage: lastStudent?.content ?? "",
  });
}

// ── Route handler ────────────────────────────────────────────────────────────

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

  const { phase } = body;
  if (!phase || (phase !== "diagnose" && phase !== "fix")) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  }

  const history = (body.conversationHistory as Array<unknown>) ?? [];
  const systemPrompt = selectSystemPrompt(phase as string, history.length);
  const userMessage = buildUserMessage(body);

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
        max_tokens: MAX_TOKENS,
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
    // Strip any accidental markdown fences the model may emit
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("Failed to parse model JSON:", rawText);
    return NextResponse.json({ error: "Model returned non-JSON response" }, { status: 500 });
  }

  return NextResponse.json(parsed);
}
