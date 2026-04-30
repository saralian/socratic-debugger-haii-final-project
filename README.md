# Traceback: A Code Reasoning Tutor

A web-based intelligent tutoring system for beginner programmers. Rather than 
giving students the answer, Traceback guides them through diagnosing and fixing 
bugs in their own code using Socratic questioning. The student does the 
debugging work, and the AI scaffolds the thinking process.

Built for the 05-618 Human-AI Interaction final project assignment, Spring 2026.

---

## Running the App

This is a Next.js project. To run locally:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

You will need a `.env.local` file in the root directory with the following:

ANTHROPIC_API_KEY=your_api_key_here

---

## Open-Source Code Used

| Library | Purpose | Changes Made |
|---|---|---|
| [Next.js](https://nextjs.org/) | App framework and routing | Bootstrapped with `create-next-app`. All application logic, routing, and page structure written via natural language prompts to Claude Code |
| [CodeMirror 6](https://codemirror.net/) | In-browser code editor for the Submit and Fix phases | Configured with Python language support, custom read-only/editable state, and emerald-highlight styling for the working copy |
| [Anthropic SDK](https://github.com/anthropic/anthropic-sdk-python) | Claude API integration | Used as the LLM backend; all system prompts, conversation management, and response parsing drafted from scratch, polished with Claude AI (rewording and reorganizing) |
| [Tailwind CSS](https://tailwindcss.com/) | Styling | Used for all layout and design. No pre-built component library |

No pre-built UI component kits or starter templates were used beyond the 
default Next.js scaffold.

---

## New Code Implemented

All application logic was designed from scratch, and built via natural language prompt to Claude Code. Key components include:

**Three-phase tutor flow (`Submit → Diagnose → Fix`)**  
Each phase is a distinct UI state with its own layout, interaction model, and 
API call behavior. Phase transitions are controlled by the tutor's evaluation 
of the student's understanding, not by the student simply clicking "next."

**Four custom system prompts**  
Separate prompts govern: (1) internal bug diagnosis (hidden from student), 
(2) Socratic questioning during Diagnose, (3) understanding evaluation at 
hypothesis commit, and (4) fix evaluation and concept summary during Fix. 
Prompts are designed to enforce Socratic constraints - the model is explicitly 
instructed never to reveal the answer or corrected code.

**Working Hypothesis card with revision history**  
A UI component that pins the student's current hypothesis, allows 
inline editing, and maintains an expandable revision stack showing the 
student's evolving thinking across the session.

**Cross-session memory**  
Each student is assigned a stable browser-local UUID. At session end, the LLM 
generates a 2–3 sentence summary of the session (concept, how understanding 
evolved, patterns). Summaries are stored in a per-user JSON file on the server 
and injected into future sessions so the tutor can reference shared history.

**Retrospective panel**  
On a correct fix, the tutor panel is replaced with a "What you learned" 
summary and a vertical timeline of the student's hypothesis revisions, making 
the student's cognitive arc across the session visible as a concrete artifact.

**Low-friction scaffolding chips**  
Tappable chips on the Submit screen ("It crashes with an error," "It's giving 
unexpected output," etc.) pre-populate the observed-behavior field, reducing 
the barrier to starting for students who aren't sure how to describe what 
they're seeing.

---

## Design Decisions Informed by HAII Principles

**Human-in-the-loop agency**  
The student controls the pace and direction of the entire session. The AI 
never advances the phase automatically, the student decides when to submit a 
hypothesis, when to commit, and when to move to Fix. This gives the student 
agency and control, and keeps the student as the active problem-solver rather 
than a passive recipient of AI output.

**AI explainability and transparency**  
The tutor explains *why* something is a bug (the underlying mechanism), not 
just *where* it is. Vocabulary (e.g. "off-by-one error") is introduced only 
after the student has articulated the concept in their own words. 
A persistent AI disclosure banner and first-message disclaimer 
ensure students know they are interacting with an AI that can make mistakes.

**Prompt Engineering - constraining AI to serve long-term benefit**  
The system prompts explicitly prohibit the model from providing corrected code 
or revealing the answer, even if the student asks directly. This is a 
deliberate constraint on immediate helpfulness in service of long-term learning, 
which is the core tradeoff the system is designed around.

## Design Decisions Informed by Learning Science Principles

**Guided Discovery (Schwartz et al., 2011)**  
The learner leads the investigation, and the tutor never states or gives away 
the answer. This allows the student to construct understanding themselves, which 
has been shown to improve the level of learning for students, especially for 
conceptual knowledge (as opposed to skills).

**CTA-informed structure (Lovett, 1998)**  
The three-phase structure maps onto the expert debugging process: observe 
behavior → form a hypothesis → test by fixing. This was derived from a 
Cognitive Task Analysis of expert debugging, which identified the 
observation-before-hypothesis separation and causal mechanism articulation as 
the highest-value intervention points for novice learners.

---

## Pilot User Study

A pilot study was conducted with n=4 beginner programmers. Key findings:

- Average messages exchanged with tutor per session: 16.5  
- Average time per session: 3.75 minutes  
- Qualitative feedback: users reported feeling they learned more than they 
  would have from pasting code into a general-purpose LLM

**Design changes made as a result:**
- Added the "I'm not sure" button as a first-class option (not a fallback) at 
  both the observation and hypothesis steps, after users expressed uncertainty 
  about how to proceed when they had no initial hypothesis
- Noted for future iteration: prompts need adjustment to handle imprecise 
  student language more gracefully; hypothesis card interaction needs refinement

---

## Full Prompt Text

All six system prompts used with the Claude API are included below.

**Prompt 1: `diagnose-init` (Phase 1 -> 2 transition, internal + opening)**

Returns a JSON object containing: the bug's line number, concept name, and blurb (never shown to the student yet); an internal bug summary used to guide all subsequent questioning; and the opening hypothesis prompt shown above the Working Hypothesis card. This is the only prompt that performs internal diagnosis.

```
You are a Socratic debugging tutor. A beginner programmer has submitted buggy Python code along with a description of what they observe happening when they run it. Your job is to diagnose the bug internally and generate an opening prompt that invites the student to theorize about the cause.

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
- The hypothesisPrompt should be a single warm sentence that acknowledges what the student observed and asks them to think about why — without referencing the code, the loop, any specific line, or anything that implies you already know the cause. It should feel like a neutral open door, not a leading question. Example: "You noticed it crashes — what do you think might be causing that?"

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "lineNumber": <integer — 1-indexed line where the primary bug is>,
  "conceptName": <short name of the concept, e.g. "Off-by-one error", "Integer division">,
  "conceptBlurb": <2-3 sentence plain-English explanation of the concept written for a beginner. Shown to the student as the Concept card reveal ONLY after they have earned it — never before.>,
  "internalBugSummary": <1-2 sentence internal description of the exact bug — used to guide follow-up questioning, never shown to the student>,
  "observationUnsure": <true if observedBehavior is "I'm not sure" or equivalent, false otherwise>,
  "hypothesisPrompt": <a single warm sentence shown above the Working Hypothesis card>
}
```

**Prompt 2: `diagnose-hypothesis` (Phase 2, ongoing Socratic dialogue)**

Responds to the student's current hypothesis with one Socratic question. Can signal when the student is ready to commit.

```
You are a Socratic debugging tutor continuing a debugging session with a beginner programmer.

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
}
```

**Prompt 3: `diagnose-unsure` (Phase 2, student has no hypothesis)**

Handles the case where the student clicks "I'm not sure." Distinguishes between two situations: student was also unsure about their observation (asks them to run the code first) vs. student has an observation but no cause theory (asks a concrete narrowing question).

```
You are a Socratic debugging tutor. A beginner programmer has said they are not sure what is causing the bug in their code.

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
}
```

**Prompt 4: `diagnose-commit` (Phase 2, hypothesis evaluation)**

Evaluates whether the student's committed hypothesis demonstrates genuine causal understanding (ie., explaining the mechanism, not just identifying a line). If earned, reveals the concept name. If not, pushes back with one targeted question.

```
You are a Socratic debugging tutor evaluating whether a student has earned the right to see the name and explanation of the concept behind the bug they have been investigating.

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
- Write a tutorMessage that affirms warmly, explains the mechanism precisely, then names the concept naturally ("What you've just worked out is called..."). The tutorMessage is the concept reveal — write it as a complete, satisfying explanation the student will remember.

If conceptEarned is false:
- Write a tutorMessage that gently pushes back without revealing the answer. Acknowledge what they got right, then ask one more question that targets the gap.
- Do NOT name the concept in the tutorMessage.
- A "not yet" should feel like a nudge toward understanding, not a failure.

RULES — never violate:
- Do NOT reveal the corrected code.
- Do NOT name the concept if conceptEarned is false.

Respond with ONLY a JSON object (no markdown, no surrounding text):
{
  "conceptEarned": <true | false>,
  "tutorMessage": <your response>
}
```

**Prompt 5: `fix-eval` (Phase 3, fix evaluation)**

Evaluates whether the student's edited code correctly resolves the bug. Returns one of three verdicts: correct (with a concept summary), incorrect (with a guiding question), or partial (acknowledges what's right, asks about the new issue).

```
You are a Socratic debugging tutor evaluating a student's attempted fix to a bug they have worked through with you.

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
}
```

**Prompt 6: `session-summary` (end of session, memory + retrospective)**

Generates two outputs: a 2–3 sentence third-person memory entry stored server-side for future session personalization, and a single warm second-person sentence shown to the student in the retrospective panel.

```
You are summarizing a completed debugging tutoring session for two purposes:
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
}
```

## Use of AI Acknowledgements

As per the class policy regarding AI use, I want to make clear how AI was used in this project. This project was built in close collaboration with Claude AI and Claude Code - the following documents what was designed, created, or directed by me versus what was implemented or drafted by AI tools.

### My Contributions

**Research and learning science grounding**
The Cognitive Task Analysis of expert debugging behavior, including an expert
debugging flowchart created in FigJam, was conducted and produced entirely by
me. The three-phase structure of the app (Submit → Diagnose → Fix) was my own
design decision, derived from that analysis. The selection of learning science
principles (guided discovery, metacognitive scaffolding, CTA-informed design)
and how they map onto specific UI decisions was entirely my own.

**UI/UX design**
I produced early wireframes with Claude AI as a thinking partner, but the final
designs were fully designed by me in Figma, including all screen layouts,
interaction flows, visual hierarchy, component decisions, and all written
content on screen (sentences, headings, labels, microcopy, and placeholder
text).

**System prompt authorship**
I wrote the initial drafts of all six system prompts, including their
structure, the core Socratic constraints, the JSON output schemas, and the
behavioral rules governing when the model could and could not reveal
information. Claude AI expanded and refined these drafts, turning shorthand
rules into full sentences and improving clarity, but the underlying logic,
structure, and constraints originated with me.

**CLAUDE.md**
I wrote the initial CLAUDE.md file to direct Claude Code's work, including
the project conventions, component structure expectations, and behavioral
guidelines for the codebase. Claude Code updated this file over the course of
the project when prompted by me.

**README.md**
I authored the initial README structure and content, including the section
organization, contribution descriptions, and prompt documentation. Claude AI
assisted with expanding and polishing the language.

**Pilot user study**
The study design, participant recruiting, task selection, session facilitation,
and analysis of results were conducted entirely by me. No AI assistance was
used in interpreting or synthesizing the findings.

**Data model and memory architecture**
While I did not write the implementation code myself, I designed the data model
and memory logic (per-user UUID, session summary structure, context injection
into future sessions) and described it in detail to Claude Code via natural
language prompts.

### Claude Code's Contributions

All application code was written by Claude Code based on natural language
prompts and design direction from me. This includes all React components, API
route logic, CodeMirror editor integration, state management, and server-side
memory handling. Every change Claude Code made to the codebase was explicitly
reviewed and approved by me in the Claude Code interface before being accepted. No changes were auto-applied without my review.

### Summary Table

| Contribution | Me | Claude AI | Claude Code |
|---|---|---|---|
| Learning science research and CTA | ✅ | | |
| Expert debugging flowchart (FigJam) | ✅ | | |
| Early wireframes | ✅ | Thinking partner | |
| Final UI/UX design (Figma) | ✅ | | |
| All on-screen written content | ✅ | | |
| System prompt structure and logic | ✅ | Expanded + refined | |
| CLAUDE.md (initial) | ✅ | | |
| CLAUDE.md (updates) | Directed | | ✅ |
| README.md (structure + content) | ✅ | Expanded + polished | |
| Data model and memory architecture | ✅ (designed) | | ✅ (implemented) |
| All application code | | | ✅ (reviewed by me) |
| Pilot user study | ✅ | | |