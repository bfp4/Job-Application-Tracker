"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { CopyField } from "@/components/CopyButton";
import { inputClassName } from "@/lib/ui";
import type { Contact } from "@/lib/types";

/** The editable contact fields, as they appear in the form inputs. */
interface ContactFields {
  name: string;
  position: string;
  linkedinUrl: string;
  phone: string;
  email: string;
  notes: string;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15;

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

/** Whether the given string is a valid LinkedIn profile URL. */
function isValidLinkedInUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return /(^|\.)linkedin\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
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
 * "Contacts" card on the application detail page: people the user is in
 * contact with about this application (recruiter, hiring manager, referral).
 * Mutations patch the parent page's application state through `setContacts`
 * instead of re-fetching.
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

  // Polls until the placeholder contact's scrape resolves, then patches it
  // into state. Gives up after MAX_POLL_ATTEMPTS so a hung/lost job doesn't
  // poll forever — the row is left as PENDING, which reads as stuck rather
  // than silently wrong.
  async function pollForScrapeResult(contactId: string) {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const res = await apiFetch(`/api/applications/${applicationId}`);
      if (!res.ok) continue;

      const data = (await res.json().catch(() => ({}))) as {
        application?: { contacts?: Contact[] };
      };
      const updated = data.application?.contacts?.find((c) => c.id === contactId);
      if (!updated) return; // contact was deleted while we were polling

      if (updated.scrapedStatus !== "PENDING") {
        setContacts((cs) => cs.map((c) => (c.id === contactId ? updated : c)));
        return;
      }
    }
  }

  async function handleScrape(linkedinUrl: string) {
    const res = await apiFetch(`/api/applications/${applicationId}/scrape-linkedin`, {
      method: "POST",
      body: JSON.stringify({ linkedinUrl }),
    });
    const contact = await requestJson(res, "Failed to start LinkedIn scrape.");
    setContacts((cs) => [...cs, contact]);
    void pollForScrapeResult(contact.id);
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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Contacts</h2>
      <p className="mt-1 text-sm text-gray-500">
        People you&apos;re in touch with about this application — recruiters, hiring
        managers, referrals.
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {contacts.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No contacts yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {contacts.map((contact) => (
            <ContactItem
              key={contact.id}
              contact={contact}
              onSave={handleSave}
              onDelete={handleDelete}
              setError={setError}
            />
          ))}
        </ul>
      )}

      <AddContactForm onAdd={handleAdd} onScrape={handleScrape} setError={setError} />
    </div>
  );
}

function ContactItem({
  contact,
  onSave,
  onDelete,
  setError,
}: {
  contact: Contact;
  onSave: (contactId: string, fields: ContactFields) => Promise<void>;
  onDelete: (contactId: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-lg border border-gray-100 bg-gray-50 p-4">
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
    <li className="rounded-lg border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {contact.name}
            {contact.position && (
              <span className="font-normal text-gray-500"> · {contact.position}</span>
            )}
            {contact.scrapedStatus === "PENDING" && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                Fetching from LinkedIn…
              </span>
            )}
            {contact.scrapedStatus === "FAILED" && (
              <span className="ml-2 text-xs font-normal text-red-500">
                Couldn&apos;t fetch that profile — edit the fields manually.
              </span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="text-gray-900 underline"
              >
                LinkedIn
              </a>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="text-gray-900 underline">
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="text-gray-900 underline">
                {contact.phone}
              </a>
            )}
          </div>
          {contact.notes && (
            <p className="mt-2 whitespace-pre-line text-xs text-gray-500">
              {contact.notes}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className="text-sm text-gray-400 hover:text-gray-900"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void onDelete(contact.id).catch(() =>
                setError("Failed to remove contact.")
              );
            }}
            className="text-sm text-gray-400 hover:text-red-600"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

function AddContactForm({
  onAdd,
  onScrape,
  setError,
}: {
  onAdd: (fields: ContactFields) => Promise<void>;
  onScrape: (linkedinUrl: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  // Remounting the form on each added contact resets its fields.
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <h3 className="text-sm font-medium text-gray-900">Add a contact</h3>
      <ContactForm
        key={formKey}
        initial={EMPTY_FIELDS}
        submitLabel="Add"
        pendingLabel="Adding…"
        onSubmit={async (fields) => {
          await onAdd(fields);
          setFormKey((k) => k + 1);
        }}
        onScrape={async (linkedinUrl) => {
          await onScrape(linkedinUrl);
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
  onScrape,
  setError,
}: {
  initial: ContactFields;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (fields: ContactFields) => Promise<void>;
  onCancel?: () => void;
  onScrape?: (linkedinUrl: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [fields, setFields] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [scraping, setScraping] = useState(false);

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

  async function handleScrapeClick() {
    if (!onScrape) return;
    setScraping(true);
    setError(null);
    try {
      await onScrape(fields.linkedinUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start LinkedIn scrape.");
    } finally {
      setScraping(false);
    }
  }

  const textInputs: { field: keyof ContactFields; label: string; type?: string; placeholder?: string }[] = [
    { field: "name", label: "Name *", placeholder: "e.g. Dana Smith" },
    { field: "position", label: "Position", placeholder: "e.g. Engineering Manager" },
    { field: "email", label: "Email", type: "email", placeholder: "dana@company.com" },
    { field: "phone", label: "Phone", type: "tel", placeholder: "+1 555 123 4567" },
  ];

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {textInputs.map(({ field, label, type, placeholder }) => (
          <div key={field}>
            <label className="block text-xs font-medium text-gray-700">{label}</label>
            <div className="mt-1">
              <CopyField value={fields[field]}>
                <input
                  type={type ?? "text"}
                  value={fields[field]}
                  onChange={(e) => setField(field, e.target.value)}
                  placeholder={placeholder}
                  className={`w-full bg-white pr-9 ${inputClassName}`}
                />
              </CopyField>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <div className={onScrape ? "w-3/4" : "w-full"}>
          <label className="block text-xs font-medium text-gray-700">LinkedIn</label>
          <div className="mt-1">
            <CopyField value={fields.linkedinUrl}>
                <input
                  type="url"
                  value={fields.linkedinUrl}
                  onChange={(e) => setField("linkedinUrl", e.target.value)}
                placeholder="https://www.linkedin.com/in/…"
                className={`w-full bg-white pr-9 ${inputClassName}`}
              />
            </CopyField>
        </div>
      </div>
      {onScrape && (
        <button
          type="button"
          onClick={handleScrapeClick}
          disabled={
            submitting || scraping || !isValidLinkedInUrl(fields.linkedinUrl)
          }
          className="w-1/4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {scraping ? "Adding…" : "Add from LinkedIn"}
        </button>
      )}
      </div>
      <div className="mt-3">
        <label className="block text-xs font-medium text-gray-700">Notes</label>
        <div className="mt-1">
          <CopyField value={fields.notes} multiline>
            <textarea
              value={fields.notes}
              onChange={(e) => setField("notes", e.target.value)}
              rows={2}
              placeholder="e.g. Met at the campus career fair — said to mention her referral."
              className={`w-full bg-white pr-9 ${inputClassName}`}
            />
          </CopyField>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting || !fields.name.trim()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? pendingLabel : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
