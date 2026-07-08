"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { inputClassName } from "@/lib/ui";
import type { ApplicationQuestion } from "@/lib/types";

/**
 * "Application questions" card on the application detail page: questions the
 * application form asks (e.g. "What project are you most proud of?"), each
 * with an answer that can be drafted by AI from the resume + posting + notes,
 * then edited by hand. Mutations patch the parent page's application state
 * through `setQuestions` instead of re-fetching.
 */
export default function QuestionsSection({
  applicationId,
  questions,
  setQuestions,
}: {
  applicationId: string;
  questions: ApplicationQuestion[];
  setQuestions: (
    updater: (questions: ApplicationQuestion[]) => ApplicationQuestion[]
  ) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  function replaceQuestion(updated: ApplicationQuestion) {
    setQuestions((qs) => qs.map((q) => (q.id === updated.id ? updated : q)));
  }

  async function handleAdd(questionText: string) {
    const res = await apiFetch(`/api/applications/${applicationId}/questions`, {
      method: "POST",
      body: JSON.stringify({ question: questionText }),
    });
    if (!res.ok) throw new Error("Failed to add question.");
    const { question } = (await res.json()) as { question: ApplicationQuestion };
    setQuestions((qs) => [...qs, question]);
  }

  async function handleSaveAnswer(question: ApplicationQuestion, answer: string) {
    const body = { answer: answer.trim() === "" ? null : answer };
    const res = await apiFetch(`/api/questions/${question.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to save answer.");
    const { question: updated } = (await res.json()) as { question: ApplicationQuestion };
    replaceQuestion(updated);
  }

  async function handleDraft(
    question: ApplicationQuestion,
    mode: "new" | "refine",
    draft?: string
  ) {
    const res = await apiFetch(`/api/questions/${question.id}/answer`, {
      method: "POST",
      // The server only reads `draft` for refine; undefined serializes away.
      body: JSON.stringify({ mode, draft }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      question?: ApplicationQuestion;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to draft an answer.");
    }
    if (data.question) replaceQuestion(data.question);
  }

  async function handleDelete(questionId: string) {
    const res = await apiFetch(`/api/questions/${questionId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to remove question.");
    setQuestions((qs) => qs.filter((q) => q.id !== questionId));
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Application questions</h2>
      <p className="mt-1 text-sm text-gray-500">
        Paste questions from the application form. Let AI draft an answer from your
        resume, this posting, and your notes — or write your own rough draft and have
        AI refine it while keeping your ideas and voice.
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {questions.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No questions yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {questions.map((question) => (
            <QuestionItem
              key={question.id}
              question={question}
              onSaveAnswer={handleSaveAnswer}
              onDraft={handleDraft}
              onDelete={handleDelete}
              setError={setError}
            />
          ))}
        </ul>
      )}

      <AddQuestionForm onAdd={handleAdd} setError={setError} />
    </div>
  );
}

function QuestionItem({
  question,
  onSaveAnswer,
  onDraft,
  onDelete,
  setError,
}: {
  question: ApplicationQuestion;
  onSaveAnswer: (question: ApplicationQuestion, answer: string) => Promise<void>;
  onDraft: (
    question: ApplicationQuestion,
    mode: "new" | "refine",
    draft?: string
  ) => Promise<void>;
  onDelete: (questionId: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [answerDraft, setAnswerDraft] = useState(question.answer ?? "");
  const [draftingMode, setDraftingMode] = useState<"new" | "refine" | null>(null);
  const drafting = draftingMode !== null;
  // Tracks the last server-confirmed answer so blur only PATCHes real edits,
  // and an AI draft arriving via props can refresh the textarea.
  const [savedAnswer, setSavedAnswer] = useState(question.answer ?? "");

  // Sync in an AI-drafted answer (props changed underneath local state).
  if ((question.answer ?? "") !== savedAnswer) {
    setSavedAnswer(question.answer ?? "");
    setAnswerDraft(question.answer ?? "");
  }

  async function handleBlur() {
    if (answerDraft === savedAnswer) return;
    setError(null);
    try {
      await onSaveAnswer(question, answerDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save answer.");
    }
  }

  async function handleDraftClick(mode: "new" | "refine") {
    if (
      mode === "new" &&
      answerDraft.trim() !== "" &&
      !confirm("Discard the current answer and write a completely new AI draft?")
    ) {
      return;
    }
    setDraftingMode(mode);
    setError(null);
    try {
      // Refine sends the textbox contents so unsaved edits guide the AI too.
      await onDraft(question, mode, mode === "refine" ? answerDraft : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft an answer.");
    } finally {
      setDraftingMode(null);
    }
  }

  const primaryButtonClass =
    "rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <li className="rounded-lg border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-900">{question.question}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            void onDelete(question.id).catch(() =>
              setError("Failed to remove question.")
            );
          }}
          className="shrink-0 text-sm text-gray-400 hover:text-red-600"
        >
          Remove
        </button>
      </div>

      <textarea
        value={answerDraft}
        onChange={(e) => setAnswerDraft(e.target.value)}
        onBlur={handleBlur}
        rows={answerDraft ? 6 : 3}
        disabled={drafting}
        className={`mt-3 w-full bg-white ${inputClassName}`}
        placeholder="Your answer — write it yourself or draft it with AI."
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {answerDraft.trim() !== "" && (
          <button
            type="button"
            onClick={() => handleDraftClick("refine")}
            disabled={drafting}
            title="Improve the current answer with AI — keeps its ideas and voice."
            className={primaryButtonClass}
          >
            {draftingMode === "refine" ? "Refining…" : "Refine my draft"}
          </button>
        )}
        <button
          type="button"
          onClick={() => handleDraftClick("new")}
          disabled={drafting}
          title="Write a completely new answer from your resume, this posting, and your notes."
          className={
            answerDraft.trim() !== ""
              ? "rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              : primaryButtonClass
          }
        >
          {draftingMode === "new"
            ? "Drafting…"
            : answerDraft.trim() !== ""
              ? "New draft"
              : "Draft with AI"}
        </button>
        {drafting && (
          <span className="text-sm text-gray-500">
            {draftingMode === "refine"
              ? "Refining your draft with your resume and this posting…"
              : "Reading your resume and this posting…"}
          </span>
        )}
      </div>
    </li>
  );
}

function AddQuestionForm({
  onAdd,
  setError,
}: {
  onAdd: (question: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(trimmed);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add question.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-2">
      <div className="flex-1">
        <label className="block text-xs font-medium text-gray-700">Question</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='e.g. "What is something you worked on that you are proud of?"'
          className={`mt-1 w-full ${inputClassName}`}
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !question.trim()}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
