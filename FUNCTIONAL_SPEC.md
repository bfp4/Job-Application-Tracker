# Job Application Tracker — Functional Specification

**Purpose of this document.** A complete, implementation-independent description of what this
product does, screen by screen and state by state, written to be handed to a designer (or a
design-generation tool) as the source of truth for a visual and interaction redesign. It
describes *behaviour and content*, not the current visual styling. Where the current
implementation makes a design decision worth preserving or worth challenging, it is called out
explicitly in **§11 Redesign brief**.

Current implementation for reference: Next.js/React client, Express API, Firebase Auth,
PostgreSQL, Anthropic Claude for all AI features. Live at `jobstrackeragent.vercel.app`.

---

## 1. Product overview

### 1.1 What it is

A personal job-search workspace. A user saves each job they're pursuing, moves it through a
pipeline (not applied → applied → phone screen → interview → offer / rejected), and — for each
individual posting — uses AI to produce the artefacts that application actually needs: a
tailored resume, a cover letter, answers to the form's essay questions, a LinkedIn note to a
recruiter, and coaching on what's missing from their resume.

The defining idea: **everything is scoped to one posting.** Generic resume advice is
worthless; this app always reasons about *your* resume against *this specific job*, in the
conventions of *your* career field.

### 1.2 Primary user

A single job seeker managing 5–50 concurrent applications. Not a recruiter, not a team. There
is no sharing, no collaboration, no multi-user anything. Every screen is private to one
account.

### 1.3 The three jobs the product does

| # | Job to be done | Where it lives |
|---|---|---|
| 1 | *"Don't let me lose track of anything."* | Dashboard, Applications list, Follow-ups, daily reminder email |
| 2 | *"Help me actually write the application."* | Application detail — Tailored resume, Cover letter, Application questions, Contacts |
| 3 | *"Tell me where I fall short."* | Application detail — Resume tips |

### 1.4 Core loop

```
Find a posting  →  Paste URL, autofill  →  Generate tailored resume + cover letter
     →  Draft answers to the form's questions  →  Submit, set status to Applied
     →  Schedule a follow-up  →  Get reminded by email  →  Move status forward
```

---

## 2. Accounts, authentication, and access

### 2.1 Sign-in methods

Two, both landing on the same account when the email matches:

1. **Email + password.** Requires email verification before first sign-in.
2. **Google.** No verification step; signs straight in.

### 2.2 Rules the UI must express

- **A Google-created account has no password.** Attempting email/password sign-in on it fails
  with a generic "Incorrect email or password" (the system deliberately cannot say *why*
  without revealing which emails are registered). The error state must therefore offer **both**
  remedies side by side: "use Sign in with Google" and "set a password for this email."
- **Password reset doubles as password *creation*.** A user who signed up with Google can use
  the reset flow to add a password; both sign-in methods work afterwards. Same from Settings,
  without email.
- **Password policy** (advisory checklist shown live as the user types, not server-enforced):
  at least 8 characters · one uppercase letter · one special character.
- **Unverified email/password accounts cannot sign in.** The attempt silently re-sends the
  verification link, signs the session back out, and shows a "confirm your email" notice with a
  manual resend action.
- **Never confirm whether an email is registered.** Reset confirmation copy is always "If an
  account exists for X, we've sent a link." This is a hard requirement, not a wording
  preference.

### 2.3 Route protection

Every screen except `/login`, `/signup`, and `/forgot-password` requires a session.
Unauthenticated visitors are redirected to `/login`. The root `/` redirects to `/dashboard`
when signed in, `/login` otherwise. There is **no marketing/landing page** — see §11.

---

## 3. Information architecture

```
/                        → redirect (dashboard | login)
/login                   → sign in
/signup                  → create account → "confirm your email" confirmation state
/forgot-password         → request reset → "check your inbox" confirmation state

── authenticated shell (persistent top nav: Dashboard · Applications · Settings · Sign out) ──

/dashboard               → pipeline counts + upcoming follow-ups
/applications            → add-a-job form + searchable, sortable, status-grouped list
/applications/[id]       → the workspace for one application (9 stacked sections)
/settings                → base resume · career specialization · password
```

Three top-level destinations. The application detail page is where ~90% of the product's value
and complexity lives.

---

## 4. Domain model

What the design has to display. Fields marked *(opt)* are frequently absent and every layout
must survive their absence.

### 4.1 Application — the central object

| Field | Type | Notes |
|---|---|---|
| Status | enum | `Not applied`, `Applied`, `Phone screen`, `Interview`, `Offer`, `Rejected` — fixed pipeline order |
| Applied date | date *(opt)* | User-set; **not** auto-filled when status changes |
| Where you found it ("source") | free text *(opt)* | Suggestion list: LinkedIn, Indeed, Glassdoor, Company website, Referral, Recruiter, Job board, Career fair |
| Notes | long text *(opt)* | Free-form, saved on blur |
| Created / updated | timestamp | "Added" date shown in list detail |

Owns: one job posting, many follow-ups, many questions, many contacts, and at most one each of
resume analysis / tailored resume / cover letter.

### 4.2 Job posting

Title · Company · Location *(opt, **multi-value** — a posting can list several)* · Salary
*(opt, free text such as "$120k–$150k" or "DOE")* · Job URL · Description *(opt, long)* ·
Posted date *(opt)*.

Postings are per-user copies. Two users tracking the same URL each get their own editable row.

### 4.3 Follow-up

Date · Note *(opt)* · Completed (boolean). A checklist item attached to an application, and the
unit the reminder email is built from.

### 4.4 Contact

A person attached to one application: Name · Position *(opt)* · LinkedIn URL *(opt)* · Email
*(opt)* · Phone *(opt)* · Notes *(opt)* · **LinkedIn status** (`None`, `Connection sent`,
`Connected`, `Messaging`) · **Connection message** *(opt, ≤300 chars — LinkedIn's own limit)*.

### 4.5 Application question

A question copied from the employer's application form, plus an answer that may be AI-drafted,
hand-written, or both. The record does not distinguish authorship.

### 4.6 Base resume (account-level, not per-application)

One PDF per user; the most recent upload is "current". Max 10 MB, PDF only. Everything AI
generates is derived from it, so **an account with no resume has five features disabled at
once** — this must be handled as a first-class onboarding state, not five separate warnings.

### 4.7 Career specialization (account-level)

One of nine fields, driving the tone, vocabulary, and section headings of *every* AI feature:

`General` · `Software Engineering` · `Finance & Banking` · `Consulting` · `Marketing` ·
`Sales` · `Healthcare & Nursing` · `Design & Creative` · `Data & Analytics`

---

## 5. Screen: Dashboard (`/dashboard`)

**Purpose.** Answer "where do things stand, and what needs doing today?" in one glance.

### 5.1 Content

1. **Heading** — "Dashboard", with the signed-in email as a subtitle.
2. **Primary action** — "Add a job" → `/applications?add=1` (opens the add form pre-expanded).
3. **Pipeline counts** — seven tiles: `Total applications`, then one per status in pipeline
   order, each showing the status name and a count.
4. **Upcoming follow-ups** — every *incomplete* follow-up across every application, sorted by
   date ascending, no limit and no date cut-off. Each row: company · role title · note *(opt)* ·
   application's current status · due date. The whole row navigates to that application.

### 5.2 States

| State | Behaviour |
|---|---|
| Loading | "Loading your dashboard…" |
| Error | Inline error banner |
| No applications | Tiles all read 0; follow-ups panel shows "No follow-ups scheduled. Open an application to add one." |
| No follow-ups (but has applications) | Same empty message |

### 5.3 Known gaps to fix in redesign

- Overdue follow-ups are visually identical to ones due next month. There is no urgency
  signal at all.
- The counts are inert — clicking "Interview: 3" does not filter anything.
- Nothing surfaces applications sitting in `Not applied`, even though the *email digest*
  nags about exactly those.

---

## 6. Screen: Applications (`/applications`)

**Purpose.** Add jobs, and find any job fast.

### 6.1 Add-a-job panel

A collapsible panel, **collapsed by default** so the list is the first thing seen (expanded on
arrival from the dashboard's "Add a job" link, and openable from the empty state).

**Fields**

| Field | Required | Input behaviour |
|---|---|---|
| Job URL | ✓ | URL field, paired with an **Autofill** button |
| Title | ✓ | Text |
| Company | ✓ | Text with remote company-name autocomplete (suggestions with domain; degrades silently to plain text) |
| Location | | **Multi-value chips.** Google Places autocomplete for real places, *plus* a separate plain-text field for non-places like "Remote"/"Hybrid" |
| Salary | | Free text, placeholder "e.g. $120k–$150k, or DOE" |
| Where you found it | | Free text with the source suggestion list |
| Description | | Multi-line |

**Autofill flow.** Paste an **AshbyHQ or Greenhouse** URL → press Autofill → the button reads
"Autofilling…" → all fields populate (including replacing the pasted URL with the board's
canonical one) → a success note appears: *"Filled in from the posting — review the details
before saving."* Unsupported hosts return a clear message: only Ashby and Greenhouse are
supported today. **The user must always be able to fix autofilled values before saving.**

**On save** the user is taken directly to the new application's detail page — the add form is
an on-ramp to the workspace, not an end in itself.

### 6.2 List

**Controls:** a free-text search (matches company, title, location, source) and a sort select —
Newest first *(default)* · Oldest first · Applied date newest · Applied date oldest · Company
A–Z · Title A–Z.

**Grouping:** results are grouped into one collapsible section per status, in pipeline order.
Empty groups are hidden entirely. Each section header shows the status badge and "N
applications". Collapse state persists across sessions.

**Row (desktop table):** expand chevron · Company · Title · **"Move to" status select** ·
Applied date. Clicking the row opens the application; the status select and the chevron do not.

**Row (mobile list):** company / title / applied date stacked, with the status select on its
own line below.

**Expanded row** reveals, without any extra network request: Location · Salary · Where you found
it · Applied · Posted · Added — then open follow-ups, notes, and a scrollable description, then
"Open application" and "View posting ↗".

**Status changes are optimistic** — the UI updates immediately and rolls back with an error
banner if the save fails.

### 6.3 States

| State | Behaviour |
|---|---|
| Loading | "Loading applications…" |
| Zero applications | Dashed-border card: "No applications yet." + "Add your first job" button |
| Search matches nothing | Dashed-border card: `No applications match "<query>".` |
| Error | Inline banner above the list |

### 6.4 Known gaps to fix in redesign

- Status is changed via a `<select>` inside a table row. A pipeline this central deserves a
  better interaction (drag between columns, or a segmented stepper).
- No filtering by status, company, or date — only free text.
- No bulk actions and no archive; rejected applications accumulate in the list forever.

---

## 7. Screen: Application detail (`/applications/[id]`)

**Purpose.** The workspace for one job: everything the user needs to research, write, submit,
and chase that single application.

### 7.1 Structure

A back link, then **nine stacked collapsible cards** in fixed order. Every card header shows a
title, a one-line summary that stays readable while collapsed, and (where relevant) its primary
action buttons — so a card can be triggered *without* expanding it. Collapse state is
remembered per card and **shared across all applications** (collapsing "Follow-ups" once
collapses it everywhere).

| # | Card | Header summary examples |
|---|---|---|
| 1 | Details | company · location; status badge |
| 2 | Job description | "From the posting" *(hidden if the posting has none; collapsed by default)* |
| 3 | Resume tips | "Up to date" / "Not generated yet" / "No resume uploaded" / "Analyzing…" |
| 4 | Tailored resume | "Not built yet" / "Edited by you" / "Posting or resume changed" |
| 5 | Cover letter | "Not written yet" / "Edited by you" / "Writing…" |
| 6 | Application questions | "3 of 5 answered" / "None yet" |
| 7 | Contacts | "2 contacts" / "None yet" |
| 8 | Follow-ups | "1 of 3 outstanding" / "None yet" |
| 9 | Danger zone | *(collapsed by default, red-accented)* |

This is a **very long page**. Nine stacked cards, five of which contain generated long-form
text, is the single biggest structural problem for the redesign — see §11.

### 7.2 Card 1 — Details

Header: role title, with company · location as subtitle and the status badge on the right.

Body, read mode: salary, a "View posting" link, and an **Edit job details** button. Below that,
always editable: **Status** (select), **Applied date** (date), **Where you found it** (text with
suggestions), and **Notes** (multi-line). Text fields save on blur; selects save on change.
There is no explicit Save button and no "saved" confirmation.

Body, edit mode: the button swaps the posting fields (title, company, location, salary, URL,
description) into an inline form with Save/Cancel. Server errors — e.g. "you already track that
URL" — render in the form, which stays open.

> **Behavioural gap worth fixing:** moving status to `Applied` does **not** set the applied
> date. The user must remember to set it by hand, and nothing prompts them.

### 7.3 Card 3 — Resume tips *(read-only analysis)*

**What it is.** Coaching, not an artefact. Reads the user's full resume against this posting and
returns structured advice.

**Action.** One button: "Get resume tips" → "Regenerate tips" once one exists. Pressing it
auto-expands the card. Progress copy: *"Reading your resume and this posting… this can take up
to a minute."*

**Output sections, in order:**

1. **Summary** — a paragraph on overall fit.
2. **Two field-specific focus sections** whose *headings change with the user's career
   specialization.* Each is a list of `name — reason` pairs. Examples:
   - Software Engineering → "Technologies to study" + "Systems and projects to showcase"
   - Healthcare & Nursing → "Licenses and certifications to pursue" + "Clinical details to add"
   - Finance → "Credentials and technical skills to build" + "Deals and transactions to detail"
   - Design → "Tools and craft to develop" + "Portfolio work to show"
   - *(General, Consulting, Marketing, Sales, and Data & Analytics have their own pairs.)*
   A stored analysis keeps the headings it was generated with, so a user who switches fields
   will see old analyses with old headings. **The layout cannot hard-code these headings.**
3. **Missing from your resume** — bullets.
4. **Bullet points to add or change** — each shows the *current* bullet struck through *(may be
   absent for a net-new suggestion)*, the suggested replacement, and a reason. This
   before/after pairing is the most information-dense element in the product.
5. **Strengths to highlight** — bullets.
6. **Other tips** — bullets.
7. **Provenance line** — "Generated <date> · Up to date for your current resume and this
   posting." *(or "…has changed since — you can regenerate.")*

Any section with no items is omitted entirely.

### 7.4 Card 4 — Tailored resume *(editable artefact)*

**What it is.** The user's resume rewritten for this posting — **rephrased and reordered only;
it never invents facts.** Capped at one page. Specialized by career field.

**Actions:** "Build tailored resume" / "Regenerate" · "Download PDF" · "Edit wording"
→ "Save edits" / "Cancel".

**Display.** A change note explaining the approach, then the resume itself: name and contact
line, optional summary, then sections → entries (with headings) → bullets. **Each changed
bullet shows the new text with the original struck through beneath it**, so the user can audit
every rewrite. In edit mode, the summary and every bullet become textareas; the header and
contact details are not editable.

**Provenance line:** "Generated <date> · Edited by you · Up to date…".

### 7.5 Card 5 — Cover letter *(editable artefact)*

**What it is.** A letter for this posting written from the real resume, following the
conventions of the user's field: 3–4 paragraphs, 250–400 words, supporting the resume rather
than repeating it, never claiming anything the resume doesn't say.

**Actions:** "Write cover letter" / "Regenerate" · "Download PDF" · **"Copy text"** ·
"Edit wording" → "Save edits" / "Cancel".

**Display.** An approach note, then the letter laid out as it will read: letterhead (name +
contact), recipient block *(any of name/title/company may be missing — omit the line)*,
greeting, paragraphs, closing, signature. In edit mode the greeting and each paragraph become
inputs; letterhead and recipient stay fixed.

**Two distinct outputs, deliberately:**
- **Copy text** → greeting + paragraphs + closing + signature only. No letterhead, no date —
  because it's being pasted into a web form that already collects those.
- **Download PDF** → the full formatted one-page letter, **dated the day it is downloaded.**

**Provenance line:** "<N> words · Generated <date> · Edited by you · Up to date…". The word
count is shown because "keep it short" is the advice this feature exists to satisfy.

### 7.6 Card 6 — Application questions

**What it is.** The essay questions on the employer's form ("What project are you most proud
of?"), each with an answer.

**Per question:** the question text, a Remove action, an answer textarea (grows from 3 to 6
rows once it has content, saves on blur), and **two AI actions**:

- **"Draft with AI"** — writes a completely new answer from resume + posting + notes. When an
  answer already exists this becomes the *secondary* button labelled "New draft" and asks for
  confirmation first: *"Discard the current answer and write a completely new AI draft?"*
- **"Refine my draft"** — only appears once there is text. Improves what the user wrote **while
  keeping their ideas and voice**, and sends the *unsaved* textarea contents so in-progress
  edits guide it.

The primary/secondary emphasis flips based on whether an answer exists: with an empty box,
drafting is primary; with text, refining is primary. Progress copy differs per mode.

**Add form:** a single text input, placeholder `e.g. "What is something you worked on that you are proud of?"`.

### 7.7 Card 7 — Contacts

**What it is.** People connected to this application — recruiters, hiring managers, referrals —
plus the LinkedIn outreach workflow for each.

**Per contact, display mode:** name · position, then a row of links (LinkedIn / mailto / tel),
then notes. Edit and Remove actions.

**Per contact, LinkedIn panel** (always visible beneath the contact):
- **LinkedIn status** — a select styled as a coloured pill: `None` → `Connection sent` →
  `Connected` → `Messaging`.
- **Connection message** — a textarea with a **live `N/300` character counter that turns red
  over the limit**, saved on blur.
- **"Generate message" / "Regenerate"** — drafts a short intro note from the posting, the
  resume, and where the application currently stands. Regenerating over existing text asks
  first. Progress copy: *"Reading this posting, your resume, and the application status…"*
- **"Open LinkedIn ↗"** when a URL is on file.

**Add/edit form:** Name *(required)* · Position · LinkedIn · Email · Phone in a two-column
grid, then Notes. Placeholders are concrete ("e.g. Dana Smith", "e.g. Engineering Manager",
"e.g. Met at the campus career fair — said to mention her referral").

### 7.8 Card 8 — Follow-ups

A checklist. Each item: a checkbox, the date (struck through and greyed when complete), and its
note. A Remove action per row. An inline add form: Date *(required)* + Note (placeholder "e.g.
Send thank-you email") + Add.

Header summary: "1 of 3 outstanding". These items feed both the dashboard and the daily email.

### 7.9 Card 9 — Danger zone

Collapsed by default, red-accented. "Permanently delete this application." + Delete button,
guarded by a browser `confirm()`. Deleting removes every follow-up, question, contact, and
generated artefact with it — **the current confirmation does not say so.**

### 7.10 Not-found state

If the application doesn't exist or isn't the user's: a centred card, "Application not found.",
and a "Back to applications" link.

---

## 8. Screen: Settings (`/settings`)

Three stacked sections.

1. **Base resume.** A PDF file input, an "Uploading…" indicator, and either "Resume on file. ·
   Uploaded <date>" or "No resume uploaded yet." Errors are specific and actionable: "PDF must
   be 10MB or smaller." · "Only PDF files are accepted." · "That file isn't a valid PDF." ·
   "That PDF couldn't be read. Try re-exporting it and uploading again."

   > **Gap:** the user cannot view, download, replace-with-confirmation, or delete the resume,
   > and cannot see its filename. It is a write-only black box that silently powers five
   > features. Uploading a new one also invalidates every generated artefact across every
   > application — with no warning.

2. **Career specialization.** A single select of the nine fields, saved optimistically with a
   "Saving…" hint and rolled back on failure. Explanatory copy states that it governs tailored
   resumes, cover letters, resume tips, LinkedIn notes, and application answers — deciding
   which achievements to foreground, which keywords matter, and what advice is worth giving.

   > **Gap:** changing this does not invalidate or offer to regenerate existing artefacts, and
   > gives no preview of what will differ.

3. **Password.** Adapts entirely to the account type. With a password: "Change password" +
   current/new/confirm. Without one (Google account): "Set a password", no current-password
   field, explanatory copy that Google sign-in keeps working, and a note that Google
   re-confirmation will be required. The **three password rules render as a live checklist**
   (○ → ✓, grey → green) as the user types.

---

## 9. Cross-cutting patterns

These recur everywhere and should be designed once, as a system.

### 9.1 Staleness gating — the product's signature mechanic

Each of the three big AI artefacts records the resume version and a fingerprint of the
posting's content it was generated from. **While both are unchanged, regeneration is blocked**
(button disabled, tooltip: *"Already up to date — update your resume or this posting to run a
new analysis."*). Editing the posting or uploading a new resume re-enables it. This exists to
make it impossible to burn money re-running an identical request, and it needs a clear, calm
visual language across all three cards:

| State | Meaning | Current copy |
|---|---|---|
| Not generated | Never run | "Not generated yet" / "Not built yet" / "Not written yet" |
| Up to date | Locked; regeneration disabled | "Up to date" |
| Stale | Inputs changed; regeneration available | "Posting or resume changed" |
| Edited | User hand-edited; regenerating destroys their work | "Edited by you" |
| No resume | Feature unavailable account-wide | "No resume uploaded" |

Two conflict cases need designed treatment:
- **Edited + regenerate** → confirm first: *"You've edited this resume. Regenerating will
  replace your edits. Continue?"*
- **Another tab already regenerated** → the view silently re-syncs to the server's state rather
  than showing an error.

### 9.2 Generation as a first-class state

Every AI action takes **up to a minute**. The current design offers only a verb-changed button
("Analyzing…", "Building…", "Writing…", "Drafting…", "Refining…", "Generating…") plus a line of
prose describing what's happening. Because the trigger buttons live in card *headers*, pressing
one auto-expands its card so progress is visible. There is no progress bar, no cancel, no
partial/streaming output, and no way to leave the page and come back to a finished result.
**This is the highest-value area for redesign** — see §11.

### 9.3 Copy affordances

Almost every text input and textarea in the product carries an overlaid copy-to-clipboard icon
button that flashes a checkmark on success and renders nothing when the field is empty. This is
deliberate: the user's whole workflow is moving text out of this app into an employer's form.

### 9.4 Save semantics

- Text fields and textareas: **save on blur**, only when the value actually changed.
- Selects and checkboxes: save on change, optimistically.
- Explicit Save/Cancel only inside the two artefact editors and the posting edit form.
- There is currently **no success confirmation anywhere** — silence means saved.

### 9.5 Feedback and errors

Errors are inline banners (page-level) or inline paragraphs (card-level), plain-language, and
carry the server's own message where it's user-meaningful. There are **no toasts, no modals,
and no confirmation UI** other than three browser `confirm()` dialogs (delete application,
regenerate over edits, new AI draft over an existing answer).

### 9.6 Empty and disabled states

Two shapes recur:
- **Never used** — "No X yet." + the form or button to create the first one.
- **Blocked on a prerequisite** — "Upload your resume in **Settings** to …", repeated
  independently in the tips, tailored-resume, and cover-letter cards. All three appear at once
  for a new user, which reads as three failures rather than one missing step.

### 9.7 Persistence of layout choices

Card collapse state is stored locally, per card key, shared across all applications, and
survives reload.

### 9.8 Responsive behaviour

One breakpoint matters (~640px). Above it: tables, two- and three-column form grids, four-across
stat tiles. Below it: tables become stacked lists, grids collapse to one column, tiles go
two-across. Content is capped at ~1024px wide and centred; the nav bar is sticky and
translucent.

---

## 10. Notifications — daily reminder email

Once a day, each user with anything pending receives a single plain-text digest.

**Subject:** `Job tracker: 2 follow-ups due, 1 application to submit` *(each clause present only
if that section is non-empty)*

**Body:** up to two sections —
- `FOLLOW-UPS DUE` — one line per follow-up: `- <Title> at <Company> (due <date>) — <note>`.
  Mentioned **daily from 3 days before the due date through the due date itself.**
- `NOT APPLIED YET` — one line per application still in `Not applied`:
  `- <Title> at <Company> (saved <date>)`. Nudged **daily until it leaves that status.**

Users with nothing pending get no email. Sends are de-duplicated per day, so a retry never
double-sends.

> **Gaps:** the email is plain text with no links back into the app, there are no notification
> preferences or unsubscribe control anywhere in the UI, and the "not applied" nudge has no
> counterpart on the dashboard.

---

## 11. Redesign brief

Everything above is *what the product does*. This section is *what a redesign should fix*. The
functional behaviour in §§5–10 should be preserved unless a change is called out here.

### 11.1 The five real problems

**1. The application detail page is an undifferentiated stack.**
Nine equal-weight cards, five containing long generated prose. There is no hierarchy between
"the facts about this job" (a small, stable header) and "the work I'm doing on it" (large,
active surfaces), and no way to navigate between sections without scrolling. Consider: a
persistent summary header + tabbed or side-navigated workspace; or a two-column split with
posting context pinned beside the active artefact.

**2. AI generation is a minute of nothing.**
Five features, each with a long, opaque wait and a single disabled button as feedback. Needs a
real designed state: what's being read, roughly how long, output appearing progressively if
possible, and — critically — the ability to start a generation and navigate away without losing
it.

**3. The pipeline is data, not an interface.**
Status is the product's core concept and it is currently a dropdown in a table cell. Counts on
the dashboard aren't clickable. There's no board view, no time-in-stage, no sense of momentum,
and no visual distinction between an application that's moving and one that's stalled.

**4. Nothing conveys urgency.**
A follow-up due yesterday looks exactly like one due in three weeks. The system already knows
how to compute urgency — it emails about it daily — but the interface never shows it.

**5. Onboarding doesn't exist.**
A new user lands on an empty dashboard. The resume that powers five features is buried in
Settings, and its absence surfaces as three separate "upload your resume" messages on a detail
page they haven't reached yet. There is also no signed-out landing page at all: `/` redirects
straight to `/login`, so a first-time visitor sees a login form with no explanation of what
they're logging into.

### 11.2 Design system needs

- **Six status colours** in pipeline order, working as badges, as section headers, as list
  accents, and (potentially) as board columns — plus a **four-state LinkedIn status** palette
  that reads as a *different* axis, not more of the same.
- **A "generated content" treatment** shared by tips, tailored resume, and cover letter: how AI
  output is framed, how provenance and staleness are shown, how edited-by-user is marked, how
  before/after text diffs are rendered legibly.
- **A diff pattern.** Struck-through original above/below revised text appears in two places
  (bullet suggestions, tailored resume bullets) and is central to the product's trust story:
  *you can see exactly what was changed.*
- **A long-operation pattern** covering all six AI actions consistently.
- **Dense-form styling.** The add-job form, the contact form, and the posting editor are the
  three heaviest forms; multi-value chips (location) and autocomplete dropdowns (company,
  location) need real designs.
- **A disclosure pattern** for collapsible cards whose headers must carry a title, a status
  summary, and up to two action buttons — while staying readable collapsed.

### 11.3 Constraints the design must respect

- **Section headings inside Resume tips are dynamic** — they vary by the user's career field
  and by *when* the analysis was generated. Never hard-code them.
- **Locations are a list**, not a string, and may be empty.
- **Salary is free text**, never a number or a range object.
- **The cover-letter PDF is one page and dated on download**; the copy-text output deliberately
  omits letterhead and date.
- **The connection message is hard-capped at 300 characters** (LinkedIn's own limit).
- **Every optional field is genuinely often absent** — company, salary, location, description,
  applied date, posted date, notes, and every contact field but the name. Layouts must not
  reserve space for data that isn't there or collapse when it is.
- **Never reveal whether an email address has an account** (§2.2).
- **The resume upload is account-level**; replacing it affects every application at once.
