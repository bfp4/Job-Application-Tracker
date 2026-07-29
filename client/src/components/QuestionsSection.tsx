"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { CopyField } from "@/components/CopyButton";
import { AiError } from "@/components/ai";
import {
  btnAiSm,
  btnAiSoft,
  btnPrimarySm,
  cardClassName,
  inputClassName,
  labelClassName,
} from "@/lib/ui";
import { IconNote, IconSparkles, IconTrash } from "@/components/icons";
import type { ApplicationQuestion } from "@/lib/types";

/**
 * "Application questions": the essay questions an employer's form asks, each
 * with an answer that can be AI-drafted from the resume, posting and notes,
 * then edited by hand.
 *
 * Two distinct AI actions, and which one is primary flips with the state of
 * the box: with nothing written, drafting from scratch leads; once the user
 * has words down, refining *their* draft leads, because replacing what someone
 * wrote should never be the path of least resistance.
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
    const res = await apiFetch(`/api/questions/${question.id}`, {
      method: "PATCH",
      body: JSON.stringify({ answer: answer.trim() === "" ? null : answer }),
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
    if (!res.ok) throw new Error(data.error ?? "Failed to draft an answer.");
    if (data.question) replaceQuestion(data.question);
  }

  async function handleDelete(questionId: string) {
    const res = await apiFetch(`/api/questions/${questionId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to remove question.");
    setQuestions((qs) => qs.filter((q) => q.id !== questionId));
  }

  const answered = questions.filter((q) => (q.answer ?? "").trim() !== "").length;

  return (
    <section className={cardClassName}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-base font-bold text-ink">Application questions</h2>
          <p className="mt-1 text-sm text-muted">
            Paste the questions this form asks. Draft an answer from your resume and
            this posting, or write a rough one and have it refined in your own voice.
          </p>
        </div>
        {questions.length > 0 && (
          <span className="shrink-0 rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-muted">
            {answered} of {questions.length} answered
          </span>
        )}
      </div>

      <div className="space-y-4 border-t border-border p-5">
        {error && <AiError message={error} />}

        {questions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <IconNote size={26} className="mx-auto text-border" strokeWidth={1.5} />
            <p className="mt-2 text-sm font-medium text-muted">No questions yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
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
    </section>
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

  const hasAnswer = answerDraft.trim() !== "";

  return (
    <li className="rounded-xl border border-border bg-subtle/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{question.question}</p>
        <button
          type="button"
          aria-label="Remove question"
          onClick={() => {
            setError(null);
            void onDelete(question.id).catch(() => setError("Failed to remove question."));
          }}
          className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger"
        >
          <IconTrash size={16} />
        </button>
      </div>

      <div className="mt-3">
        <CopyField value={answerDraft} multiline>
          <textarea
            value={answerDraft}
            onChange={(e) => setAnswerDraft(e.target.value)}
            onBlur={handleBlur}
            rows={hasAnswer ? 6 : 3}
            disabled={drafting}
            aria-label={`Answer to: ${question.question}`}
            placeholder="Your answer — write it yourself or draft it with AI."
            className={`w-full pr-9 ${inputClassName}`}
          />
        </CopyField>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {hasAnswer && (
          <button
            type="button"
            onClick={() => handleDraftClick("refine")}
            disabled={drafting}
            title="Improve the current answer — keeps its ideas and voice."
            className={btnAiSm}
          >
            <IconSparkles size={15} />
            {draftingMode === "refine" ? "Refining…" : "Refine my draft"}
          </button>
        )}
        <button
          type="button"
          onClick={() => handleDraftClick("new")}
          disabled={drafting}
          title="Write a completely new answer from your resume, this posting, and your notes."
          className={hasAnswer ? btnAiSoft : btnAiSm}
        >
          <IconSparkles size={15} />
          {draftingMode === "new"
            ? "Drafting…"
            : hasAnswer
              ? "New draft"
              : "Draft with AI"}
        </button>
        {drafting && (
          <span className="text-xs font-medium text-ai">
            {draftingMode === "refine"
              ? "Refining with your resume and this posting…"
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
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <label htmlFor="newQuestion" className={labelClassName}>
          Add a question
        </label>
        <div className="mt-1.5">
          <CopyField value={question}>
            <input
              id="newQuestion"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder='e.g. "What is something you worked on that you are proud of?"'
              className={`w-full pr-9 ${inputClassName}`}
            />
          </CopyField>
        </div>
      </div>
      <button
        type="submit"
        disabled={submitting || !question.trim()}
        className={btnPrimarySm}
      >
        {submitting ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
