# Socratic Debugging Tutor

A web-based debugging tutor for beginner programmers. The user submits buggy code and forms a hypothesis about what's wrong. An LLM then guides them toward refining that hypothesis through Socratic questioning — without ever revealing the fix or naming the underlying concept up front. The student does the actual debugging and the actual diagnosis.

## Tech stack
- Next.js 15 (App Router, TypeScript, Tailwind CSS)
- CodeMirror 6 via `@uiw/react-codemirror` with `xcodeLight` theme
- Anthropic Claude API (claude-sonnet-4-20250514) via `/api/tutor` route
- Lightweight per-user JSON store for cross-session memory (see Cross-session memory)
- Deployed on Vercel

## Project structure
```
src/
  app/
    page.tsx          # main app — all UI state lives here for now
    layout.tsx
    globals.css
    api/
      tutor/
        route.ts      # LLM API route (server-side, key never in browser)
  components/
    CodeEditor.tsx    # CodeMirror wrapper component
  lib/
    memory.ts         # read/write per-user session summaries
    samples.ts        # canned code samples for Predict-Observe-Explain
prompts.md            # system prompts for each API mode
```

## Core design constraints — NEVER VIOLATE

**1. Never reveal the fix.** The tutor must never reveal the corrected code or state the fix directly. No code snippets showing the answer, no "try changing X to Y", no pseudocode of the fix.

**2. Never collapse the diagnosis step.** The tutor must not hand the student the name of the underlying concept at the start of Diagnose. The concept vocabulary is only introduced as a reveal *after* the student has articulated the underlying mechanism in their own words. Naming the concept up front skips the very step the tutor exists to train.

These two constraints are the central Human-AI interaction design decisions of the project and must be preserved in all generated code, prompts, and UI copy.

## Phase model
The app has three phases, stored in a `phase` state variable:
- `'submit'` — student pastes code and optional intent, clicks "Start debugging"
- `'diagnose'` — student forms a Working Hypothesis, then refines it through Socratic dialogue; ends when the student commits ("I think I've got it") and the tutor reveals the Concept card
- `'fix'` — student edits code and submits their attempted fix for evaluation; ends with the retrospective panel showing the student's hypothesis arc

Phases advance linearly (submit → diagnose → fix). No going back.

### Diagnose phase, in detail
The Diagnose phase is anchored by the **Working Hypothesis card** at the top of the tutor panel. Its job is to make the student's evolving mental model the central artifact of the session, rather than the tutor's diagnosis.

- On entry to Diagnose, the student is prompted to write an initial hypothesis with two sub-fields: *What's happening* and *Why you think that's happening*. A persistent "I'm not sure" button sits beside the submit action — this is a legitimate, non-demeaning path, and the tutor responds to it with a narrowing question rather than a concept announcement.
- Once submitted, the hypothesis is pinned to the top of the tutor panel. The student can edit it at any time, and the tutor may offer to revise it based on what the student says in chat ("Want to update your hypothesis based on what you just said?").
- Every revision is kept in a stack. The current hypothesis is shown; previous versions are accessible via an expandable control.
- If the student's hypothesis is wildly wrong, the tutor triggers **Predict-Observe-Explain** using a canned sample from `lib/samples.ts` — a small, runnable-looking code block presented in chat, with a prediction prompt. Samples are conversational only in the current scope (no execution); the tutor knows the output because it's part of the canned example.
- The phase ends when the student clicks **"I think I've got it."** This presents the current hypothesis for confirmation ("Your current hypothesis is: X. Ready to lock this in?") with Confirm, Edit, or Keep working options. On Confirm, the tutor evaluates the articulation. If sufficient, the Concept card is revealed and the phase advances. If not, the tutor pushes back gently and the student stays in Diagnose.

### Concept card — earned reveal, not front-loaded header
The Concept card appears only when the student has articulated the underlying mechanism sufficiently. It functions as a bridge from hard-won understanding to formal vocabulary: *"What you described is called [concept]. Here's how to recognize it elsewhere."* It is never shown at the start of Diagnose.

### Retrospective panel
At the end of Fix (or when the student completes the session), a retrospective panel displays the student's hypothesis arc — the ordered revisions from initial guess to committed understanding — plus a one-line LLM-generated summary of what was learned. This is the session's distilled artifact and the primary CTA gap-analysis data source.

## Key state variables
- `phase`: 'submit' | 'diagnose' | 'fix'
- `code`: string — student's current editable code (changes as they edit)
- `originalCode`: string — snapshot taken at Submit, never mutated after
- `studentIntent`: string — optional "what should this code do" field
- `conversationHistory`: { role: 'tutor' | 'student', content: string }[]
- `workingHypothesis`: { whatsHappening: string, whyYouThink: string } | null — current hypothesis; null before first submission or if student chose "I'm not sure"
- `hypothesisHistory`: { whatsHappening: string, whyYouThink: string, timestamp: number }[] — ordered stack of every committed revision
- `hypothesisCommitted`: boolean — true after "I think I've got it" is confirmed and validated
- `diagnosisResult`: { lineNumber, conceptName, conceptBlurb } | null — what the tutor has internally determined; used to guide questioning and populate the Concept card reveal; **never displayed at the start of Diagnose**
- `conceptRevealed`: boolean — true once the Concept card has been shown
- `sessionSummary`: string | null — generated at session end for storage in cross-session memory
- `userId`: string — browser-local UUID identifying the user for memory storage
- `isLoading`: boolean

## API route — /api/tutor
- Server-side only. Anthropic API key lives in `.env.local` as `ANTHROPIC_API_KEY`
- Accepts POST with `{ mode, code, originalCode, studentIntent, conversationHistory, workingHypothesis, hypothesisHistory, diagnosisResult, userId }`
- Returns structured JSON — see `prompts.md` for exact output schemas per mode
- Modes (one system prompt each):
  - `diagnose-init` — called when the student first submits code; returns internal `diagnosisResult` (not shown to student) plus the opening prompt for the hypothesis card
  - `diagnose-hypothesis` — called when the student submits or revises a hypothesis; returns the tutor's Socratic response and, if applicable, a flag to trigger Predict-Observe-Explain with a sample ID
  - `diagnose-unsure` — called when the student clicks "I'm not sure"; returns a narrowing question to help them form a hypothesis through dialogue
  - `diagnose-commit` — called when the student clicks "I think I've got it" and confirms; evaluates whether articulation is sufficient; if yes, returns the Concept card payload; if no, returns a gentle pushback and stays in Diagnose
  - `fix-eval` — evaluates the student's attempted fix
  - `session-summary` — end-of-session call that produces the 2-3 sentence summary stored in cross-session memory, plus the one-line retrospective summary shown in the retrospective panel

## Cross-session memory
Lightweight per-user memory, implemented as a JSON file per user keyed by `userId` (browser-local UUID for the pilot; easy to swap for real auth later).

- Storage location: `data/users/{userId}.json` (gitignored)
- Schema per user: `{ sessions: SessionSummary[] }` where `SessionSummary = { timestamp, bugCategory, finalHypothesis, fixSuccessful, summary }`
- At session end, `session-summary` mode generates `summary` (2-3 sentences: concept involved, how understanding evolved, any patterns worth remembering)
- At session start, the last 3-5 summaries are loaded and injected into the system prompt under a clearly labeled "Previous session context" section
- Abstraction lives in `lib/memory.ts` — the rest of the app never touches the filesystem directly

### How the tutor is allowed to use memory
This rule is enforced via system prompt, not just convention:

- **Allowed:** referencing shared history around concepts ("we've worked on this pattern before", "this reminds me of the loop termination we discussed last time")
- **Not allowed:** characterizing the student ("you always struggle with loops", "you tend to miss edge cases")

Shared history supports the student. Characterization labels them. The distinction is the whole point of personalization being pedagogical rather than surveillant.

## Styling conventions
- Light theme throughout — bg-zinc-50 backgrounds, zinc-900 text
- Primary action buttons: emerald-600
- Original code panel (read-only): bg-zinc-100 container, visually distinct from editable panel
- Tutor chat bubbles: bg-blue-50 border border-blue-100, left-aligned
- Student chat bubbles: bg-emerald-50 border border-emerald-100, right-aligned
- Working Hypothesis card: pinned at top of tutor panel, visually distinct from chat bubbles; use a neutral card style (bg-white with border-zinc-200) so it reads as "artifact" not "message"
- Concept card (on reveal): warmer treatment (e.g., bg-amber-50 border-amber-200) to mark it as a reward/milestone
- "I'm not sure" button: persistent, visible beside the hypothesis submit — styled as a secondary button (not ghost/tertiary), to signal legitimacy
- No dark mode

## What to preserve when making changes
1. The `originalCode` / `code` split — these must stay as separate state variables
2. The "Submit fix" button lives below the editable code panel (left side), not in the chat
3. Error type vocabulary (syntax/runtime/logic) is introduced post-session only, as a reflection prompt — never as a front-loaded gate
4. All LLM API calls go through `/api/tutor` — never call the Anthropic API from client-side code
5. The Working Hypothesis card is the anchor of Diagnose — do not regress to showing a concept card or tutor-authored diagnosis at the top of the phase
6. The Concept card is an earned reveal, never a header
7. The "I'm not sure" path must remain a first-class, non-demeaning option
8. Memory prompts must follow the shared-history-not-characterization rule

## Scope discipline
This section exists so implementation sessions don't drift into reach-goal work before the must-haves are solid.

**Must-haves (target for pilot):**
- Three-phase flow with hypothesis-driven Diagnose
- Working Hypothesis card with sub-fields, submit, "I'm not sure" button
- Socratic chat that responds to the hypothesis
- "I think I've got it" commitment flow with tutor validation
- Earned Concept card reveal
- Within-session memory (conversation history passed back to the API)

**Should-haves (target if time permits):**
- Hypothesis revision stack (expandable previous versions)
- End-of-session retrospective panel
- Cross-session memory (per-user JSON, last 3-5 summaries injected at session start)
- Predict-Observe-Explain with canned samples (no execution)

**Reach goals (future work, not in current scope):**
- Pyodide integration for runnable samples and deterministic variable traces
- Deeper pedagogical personalization that actively adapts question style based on history
- Real authentication replacing browser-local UUIDs
- Variable trace visualization (deferred pending reliable execution backbone)