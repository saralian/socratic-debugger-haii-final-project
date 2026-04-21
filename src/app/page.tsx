"use client";

import { useState } from "react";
import CodeEditor from "@/components/CodeEditor";

const SEED_CODE = `def average(numbers):
    return sum(numbers) / len(numbers) - 1

result = average([2, 4, 6])
print(result)
`;

export default function Home() {
  const [code, setCode] = useState(SEED_CODE);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Socratic Debugging Tutor</h1>
          <p className="placeholder-zinc-400 text-sm mt-1">
            Paste your buggy code below. I'll help you find and understand the bug — you'll do the fixing.
          </p>
        </header>

        <section className="mb-4">
          <label className="block text-sm placeholder-zinc-400 mb-2">
            Your code
          </label>
          <CodeEditor value={code} onChange={setCode} height="300px" />
        </section>

        <section className="mb-4">
          <label className="block text-sm placeholder-zinc-400 mb-2">
            What should this code do? (optional)
          </label>
          <textarea
            className="w-full bg-white border border-zinc-300 rounded-md p-3 text-sm text-zinc-900 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            rows={2}
            placeholder="e.g. compute the average of a list of numbers"
          />
        </section>

        <button
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-5 py-2 rounded-md transition"
          onClick={() => console.log("submit clicked — wiring comes next step")}
        >
          Start debugging
        </button>
      </div>
    </main>
  );
}