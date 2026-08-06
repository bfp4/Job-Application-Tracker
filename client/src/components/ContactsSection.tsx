"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { CopyField } from "@/components/CopyButton";
import { AiError } from "@/components/ai";
import {
  btnAiSm,
  btnAiSoft,
  btnPrimarySm,
  btnSecondarySm,
  cardClassName,
  inputClassName,
  labelClassName,
} from "@/lib/ui";
import {
  IconExternalLink,
  IconMail,
  IconPhone,
  IconSparkles,
  IconTrash,
  IconUsers,
} from "@/components/icons";
import {
  LINKEDIN_STATUS_ORDER,
  linkedinStatusBadgeClasses,
  linkedinStatusLabel,
} from "@/lib/linkedin";
import type { Contact, LinkedinStatus } from "@/lib/types";

// LinkedIn's connection-request note limit; mirrored on the server.
const MAX_CONNECT_MESSAGE_CHARS = 300;

/** The editable contact fields, as they appear in the form inputs. */
interface ContactFields {
  name: string;
  position: string;
  linkedinUrl: string;
  phone: string;
  email: string;
  notes: string;
}

const EMPTY_FIELDS: ContactFields = {
  name: "",
  position: "",
  linkedinUrl: "",
  phone: "",
  email: "",
  notes: "",
};

function toFields(contact: Contact): ContactFields {
  return {
    name: contact.name,
    position: contact.position ?? "",
    linkedinUrl: contact.linkedinUrl ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    notes: contact.notes ?? "",
  };
}

/** Request body for create/update: empty inputs become explicit nulls. */
function toPayload(fields: ContactFields) {
  return {
    name: fields.name.trim(),
    position: fields.position.trim() || null,
    linkedinUrl: fields.linkedinUrl.trim() || null,
    phone: fields.phone.trim() || null,
    email: fields.email.trim() || null,
    notes: fields.notes.trim() || null,
  };
}

/**
 * "Contacts": the people attached to this application — recruiters, hiring
 * managers, referrals — and the LinkedIn outreach flow for each.
 *
 * Mutations patch the parent page's application state through `setContacts`
 * rather than re-fetching the whole application graph.
 */
export default function ContactsSection({
  applicationId,
  contacts,
  setContacts,
}: {
  applicationId: string;
  contacts: Contact[];
  setContacts: (updater: (contacts: Contact[]) => Contact[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function requestJson(res: Response, fallback: string): Promise<Contact> {
    const data = (await res.json().catch(() => ({}))) as {
      contact?: Contact;
      error?: string;
    };
    if (!res.ok || !data.contact) throw new Error(data.error ?? fallback);
    return data.contact;
  }

  async function handleAdd(fields: ContactFields) {
    const res = await apiFetch(`/api/applications/${applicationId}/contacts`, {
      method: "POST",
      body: JSON.stringify(toPayload(fields)),
    });
    const contact = await requestJson(res, "Failed to add contact.");
    setContacts((cs) => [...cs, contact]);
  }

  async function handleSave(contactId: string, fields: ContactFields) {
    const res = await apiFetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(toPayload(fields)),
    });
    const updated = await requestJson(res, "Failed to save contact.");
    setContacts((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function handleDelete(contactId: string) {
    const res = await apiFetch(`/api/contacts/${contactId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to remove contact.");
    setContacts((cs) => cs.filter((c) => c.id !== contactId));
  }

  function replaceContact(updated: Contact) {
    setContacts((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function handleStatusChange(contactId: string, linkedinStatus: LinkedinStatus) {
    const res = await apiFetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify({ linkedinStatus }),
    });
    replaceContact(await requestJson(res, "Failed to update LinkedIn status."));
  }

  async function handleSaveMessage(contactId: string, message: string) {
    const res = await apiFetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify({ connectMessage: message.trim() === "" ? null : message }),
    });
    replaceContact(await requestJson(res, "Failed to save message."));
  }

  async function handleGenerateMessage(contactId: string) {
    const res = await apiFetch(`/api/contacts/${contactId}/connect-message`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as {
      contact?: Contact;
      error?: string;
    };
    if (!res.ok) {
      // The up-to-date refusal carries the current contact. Adopting it repairs
      // a stale connectMessageUpToDate — otherwise a client that thinks the
      // note is redraftable (second tab, or an input edited and reverted) keeps
      // an enabled button that errors on every click.
      if (data.contact) replaceContact(data.contact);
      throw new Error(data.error ?? "Failed to generate a message.");
    }
    if (!data.contact) throw new Error("Failed to generate a message.");
    replaceContact(data.contact);
  }

  return (
    <section className={cardClassName}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-base font-bold text-ink">Contacts</h2>
          <p className="mt-1 text-sm text-muted">
            People you&apos;re in touch with about this application. Track where each
            LinkedIn connection stands and draft a short note to introduce yourself.
          </p>
        </div>
        {contacts.length > 0 && (
          <span className="shrink-0 rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-muted">
            {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
          </span>
        )}
      </div>

      <div className="space-y-4 border-t border-border p-5">
        {error && <AiError message={error} />}

        {contacts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <IconUsers size={26} className="mx-auto text-border" strokeWidth={1.5} />
            <p className="mt-2 text-sm font-medium text-muted">No contacts yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {contacts.map((contact) => (
              <ContactItem
                key={contact.id}
                contact={contact}
                onSave={handleSave}
                onDelete={handleDelete}
                onStatusChange={handleStatusChange}
                onSaveMessage={handleSaveMessage}
                onGenerateMessage={handleGenerateMessage}
                setError={setError}
              />
            ))}
          </ul>
        )}

        <AddContactForm onAdd={handleAdd} setError={setError} />
      </div>
    </section>
  );
}

function ContactItem({
  contact,
  onSave,
  onDelete,
  onStatusChange,
  onSaveMessage,
  onGenerateMessage,
  setError,
}: {
  contact: Contact;
  onSave: (contactId: string, fields: ContactFields) => Promise<void>;
  onDelete: (contactId: string) => Promise<void>;
  onStatusChange: (contactId: string, status: LinkedinStatus) => Promise<void>;
  onSaveMessage: (contactId: string, message: string) => Promise<void>;
  onGenerateMessage: (contactId: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-xl border border-border bg-subtle/40 p-4">
        <ContactForm
          initial={toFields(contact)}
          submitLabel="Save"
          pendingLabel="Saving…"
          onSubmit={async (fields) => {
            await onSave(contact.id, fields);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          setError={setError}
        />
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-border bg-subtle/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">
            {contact.name}
            {contact.position && (
              <span className="font-medium text-muted"> · {contact.position}</span>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                <IconExternalLink size={13} />
                LinkedIn
              </a>
            )}
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                <IconMail size={13} />
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <a
                href={`tel:${contact.phone}`}
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                <IconPhone size={13} />
                {contact.phone}
              </a>
            )}
          </div>
          {contact.notes && (
            <p className="mt-2 whitespace-pre-line text-xs text-muted">{contact.notes}</p>
          )}
        </div>

        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className={btnSecondarySm}
          >
            Edit
          </button>
          <button
            type="button"
            aria-label={`Remove ${contact.name}`}
            onClick={() => {
              setError(null);
              void onDelete(contact.id).catch(() => setError("Failed to remove contact."));
            }}
            className="rounded-lg p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger"
          >
            <IconTrash size={16} />
          </button>
        </div>
      </div>

      <ContactLinkedinPanel
        contact={contact}
        onStatusChange={onStatusChange}
        onSaveMessage={onSaveMessage}
        onGenerateMessage={onGenerateMessage}
        setError={setError}
      />
    </li>
  );
}

/**
 * The LinkedIn sub-panel on a contact: where the user stands in the networking
 * flow, plus an AI-drafted connection note (≤300 chars) built from the posting,
 * resume, and where the application stands.
 *
 * The note mirrors the questions pattern — edit locally, save on blur, and
 * refresh when an AI draft arrives via props.
 */
function ContactLinkedinPanel({
  contact,
  onStatusChange,
  onSaveMessage,
  onGenerateMessage,
  setError,
}: {
  contact: Contact;
  onStatusChange: (contactId: string, status: LinkedinStatus) => Promise<void>;
  onSaveMessage: (contactId: string, message: string) => Promise<void>;
  onGenerateMessage: (contactId: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [messageDraft, setMessageDraft] = useState(contact.connectMessage ?? "");
  const [savedMessage, setSavedMessage] = useState(contact.connectMessage ?? "");
  const [generating, setGenerating] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  // Sync in an AI-generated message (props changed underneath local state).
  if ((contact.connectMessage ?? "") !== savedMessage) {
    setSavedMessage(contact.connectMessage ?? "");
    setMessageDraft(contact.connectMessage ?? "");
  }

  async function handleStatusSelect(status: LinkedinStatus) {
    setError(null);
    setSavingStatus(true);
    try {
      await onStatusChange(contact.id, status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update LinkedIn status.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleMessageBlur() {
    if (messageDraft === savedMessage) return;
    setError(null);
    try {
      await onSaveMessage(contact.id, messageDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save message.");
    }
  }

  async function handleGenerateClick() {
    if (
      messageDraft.trim() !== "" &&
      !confirm("Replace the current message with a new AI draft?")
    ) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      await onGenerateMessage(contact.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate a message.");
    } finally {
      setGenerating(false);
    }
  }

  const overLimit = messageDraft.length > MAX_CONNECT_MESSAGE_CHARS;
  // The API refuses a redraft while the saved note still matches its inputs, so
  // disable the button rather than letting the click fail. Clearing the note
  // (or editing this contact, the application, or the posting) re-enables it.
  const upToDate = contact.connectMessageUpToDate;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={`linkedin-status-${contact.id}`}
          className="text-xs font-semibold text-ink"
        >
          LinkedIn status
        </label>
        <select
          id={`linkedin-status-${contact.id}`}
          value={contact.linkedinStatus}
          disabled={savingStatus}
          onChange={(e) => handleStatusSelect(e.target.value as LinkedinStatus)}
          className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset focus:outline-none disabled:opacity-60 ${linkedinStatusBadgeClasses(
            contact.linkedinStatus
          )}`}
        >
          {LINKEDIN_STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {linkedinStatusLabel(status)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <label
            htmlFor={`connect-message-${contact.id}`}
            className="text-xs font-semibold text-ink"
          >
            Connection message
          </label>
          <span
            className={`text-xs font-semibold tabular-nums ${
              overLimit ? "text-danger" : "text-muted"
            }`}
          >
            {messageDraft.length}/{MAX_CONNECT_MESSAGE_CHARS}
          </span>
        </div>
        <div className="mt-1.5">
          <CopyField value={messageDraft} multiline>
            <textarea
              id={`connect-message-${contact.id}`}
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              onBlur={handleMessageBlur}
              rows={messageDraft ? 4 : 2}
              maxLength={MAX_CONNECT_MESSAGE_CHARS}
              disabled={generating}
              placeholder="A short intro note to send with your connection request — generate one, then tweak it."
              className={`w-full pr-9 ${inputClassName}`}
            />
          </CopyField>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleGenerateClick}
          disabled={generating || upToDate}
          title={
            upToDate
              ? "This note already reflects this contact, the application, and the posting. Change one of them — or clear the note — to draft a new one."
              : "Draft a note from this posting, your resume, and where the application stands."
          }
          className={messageDraft.trim() !== "" ? btnAiSoft : btnAiSm}
        >
          <IconSparkles size={15} />
          {generating
            ? "Generating…"
            : messageDraft.trim() !== ""
              ? "Regenerate"
              : "Generate message"}
        </button>
        {generating && (
          <span className="text-xs font-medium text-ai">
            Reading this posting, your resume, and the application status…
          </span>
        )}
        {!generating && upToDate && (
          <span className="text-xs font-medium text-muted">
            Up to date — edit this contact, the application, or the posting to
            draft a new note.
          </span>
        )}
      </div>
    </div>
  );
}

function AddContactForm({
  onAdd,
  setError,
}: {
  onAdd: (fields: ContactFields) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  // Remounting the form on each added contact resets its fields.
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="border-t border-border pt-5">
      <h3 className="text-sm font-bold text-ink">Add a contact</h3>
      {/*
        The only place in the app where a user stores someone *else's* personal
        data — a recruiter or hiring manager who never signed up here and has no
        way to ask for it back. Under GDPR that makes the user the controller
        for these rows, a responsibility the Terms spell out; this is the
        just-in-time notice that puts it where the data is actually entered
        rather than only in a document nobody reads.
      */}
      <p className="mt-1 text-xs leading-5 text-muted">
        Save only what you need for your job search, and keep notes professional —
        this person hasn&apos;t signed up for JobTracker. Deleting the application
        deletes its contacts too. See our{" "}
        <Link href="/privacy" className="font-semibold text-brand hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
      <ContactForm
        key={formKey}
        initial={EMPTY_FIELDS}
        submitLabel="Add contact"
        pendingLabel="Adding…"
        onSubmit={async (fields) => {
          await onAdd(fields);
          setFormKey((k) => k + 1);
        }}
        setError={setError}
      />
    </div>
  );
}

function ContactForm({
  initial,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
  setError,
}: {
  initial: ContactFields;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (fields: ContactFields) => Promise<void>;
  onCancel?: () => void;
  setError: (error: string | null) => void;
}) {
  const [fields, setFields] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  // Several of these forms can be on the page at once — the add form plus one
  // per contact in edit mode — so the field ids have to be instance-scoped or
  // the labels point at whichever copy mounted first.
  const formId = useId();

  function setField(field: keyof ContactFields, value: string) {
    setFields((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fields.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save contact.");
    } finally {
      setSubmitting(false);
    }
  }

  const textInputs: {
    field: keyof ContactFields;
    label: string;
    type?: string;
    placeholder?: string;
  }[] = [
    { field: "name", label: "Name *", placeholder: "e.g. Dana Smith" },
    { field: "position", label: "Position", placeholder: "e.g. Engineering Manager" },
    {
      field: "linkedinUrl",
      label: "LinkedIn",
      type: "url",
      placeholder: "https://www.linkedin.com/in/…",
    },
    { field: "email", label: "Email", type: "email", placeholder: "dana@company.com" },
    { field: "phone", label: "Phone", type: "tel", placeholder: "+1 555 123 4567" },
  ];

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {textInputs.map(({ field, label, type, placeholder }) => (
          <div key={field}>
            <label htmlFor={`${formId}-${field}`} className={labelClassName}>
              {label}
            </label>
            <div className="mt-1.5">
              <CopyField value={fields[field]}>
                <input
                  id={`${formId}-${field}`}
                  type={type ?? "text"}
                  value={fields[field]}
                  onChange={(e) => setField(field, e.target.value)}
                  placeholder={placeholder}
                  className={`w-full pr-9 ${inputClassName}`}
                />
              </CopyField>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor={`${formId}-notes`} className={labelClassName}>
          Notes
        </label>
        <div className="mt-1.5">
          <CopyField value={fields.notes} multiline>
            <textarea
              id={`${formId}-notes`}
              value={fields.notes}
              onChange={(e) => setField("notes", e.target.value)}
              rows={2}
              placeholder="e.g. Met at the campus career fair — said to mention her referral."
              className={`w-full pr-9 ${inputClassName}`}
            />
          </CopyField>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting || !fields.name.trim()}
          className={btnPrimarySm}
        >
          {submitting ? pendingLabel : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className={btnSecondarySm}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
