# Socratic Debugging Tutor

A web-based debugging tutor for beginner programmers. The user submits buggy code, and an LLM guides them toward understanding the bug through Socratic questioning — without ever revealing the fix. The student does the actual debugging.

## Tech stack
- Next.js 15 (App Router, TypeScript, Tailwind CSS)
- CodeMirror 6 via `@uiw/react-codemirror` with `xcodeLight` theme
- Anthropic Claude API (claude-sonnet-4-20250514) via `/api/tutor` route
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
```

## Core design constraint — NEVER VIOLATE
The tutor must never reveal the corrected code or state the fix directly. No code snippets showing the answer, no "try changing X to Y", no pseudocode of the fix. This is the central Human-AI interaction design decision of the project and must be preserved in all generated code, prompts, and UI copy.

## Phase model
The app has three phases, stored in a `phase` state variable:
- `'submit'` — student pastes code and optional intent, clicks "Start debugging"
- `'diagnose'` — Socratic dialogue; tutor asks questions, student responds in chat
- `'fix'` — student edits code and submits their attempted fix for evaluation

Phases advance linearly (submit → diagnose → fix). No going back.

## Key state variables
- `phase`: 'submit' | 'diagnose' | 'fix'
- `code`: string — student's current editable code (changes as they edit)
- `originalCode`: string — snapshot taken at Submit, never mutated after
- `studentIntent`: string — optional "what should this code do" field
- `conversationHistory`: { role: 'tutor' | 'student', content: string }[]
- `diagnosisResult`: parsed JSON from Diagnose API call (lineNumber, conceptName, conceptBlurb, openingQuestion) | null
- `isLoading`: boolean

## API route — /api/tutor
- Server-side only. Anthropic API key lives in `.env.local` as `ANTHROPIC_API_KEY`
- Accepts POST with `{ phase, code, originalCode, studentIntent, conversationHistory, diagnosisResult }`
- Returns structured JSON — see system prompts in `prompts.md` for output schemas
- Three system prompts, one per phase (diagnose-open, diagnose-followup, fix)

## Styling conventions
- Light theme throughout — bg-zinc-50 backgrounds, zinc-900 text
- Primary action buttons: emerald-600
- Original code panel (read-only): bg-zinc-100 container, visually distinct from editable panel
- Tutor chat bubbles: bg-blue-50 border border-blue-100, left-aligned
- Student chat bubbles: bg-emerald-50 border border-emerald-100, right-aligned
- No dark mode

## What to preserve when making changes
1. The originalCode / code split — these must stay as separate state variables
2. The "Submit fix" button lives below the editable code panel (left side), not in the chat
3. Error type vocabulary (syntax/runtime/logic) is introduced post-session only, as a reflection prompt — never as a front-loaded gate
4. All LLM API calls go through `/api/tutor` — never call the Anthropic API from client-side code