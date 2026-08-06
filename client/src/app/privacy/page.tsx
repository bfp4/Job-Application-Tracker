import type { Metadata } from "next";
import LegalPage, { LegalList, LegalSection } from "@/components/LegalPage";
import {
  CONTACT_EMAIL,
  MAILING_ADDRESS,
  SERVICE_NAME,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SERVICE_NAME} collects, uses, shares, and deletes your data.`,
};

/**
 * Written to describe what this codebase actually does, not from a template.
 * If a sub-processor, a stored field, or a retention rule changes, this page
 * has to change with it — and LEGAL_LAST_UPDATED in lib/legal.ts gets bumped.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`${SERVICE_NAME} is a job-application tracker with AI writing features. This policy explains exactly what it collects, who it goes to, how long it is kept, and how to get it back or have it erased. It describes what the service actually does — not a generic template.`}
    >
      <LegalSection heading="Who we are">
        <p>
          {SERVICE_NAME} is operated by an individual developer. For anything in
          this policy — access, correction, deletion, or a complaint — write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand hover:underline">
            {CONTACT_EMAIL}
          </a>
          , or by post to {MAILING_ADDRESS}.
        </p>
        <p>
          For users in the EU/UK, we act as the <em>controller</em> for your
          account data. For the details you enter about other people, see
          &ldquo;Information about other people&rdquo; below — that relationship
          works differently.
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <p>Everything below is data you enter or upload yourself, except where noted.</p>
        <LegalList>
          <li>
            <strong className="font-semibold text-ink">Account</strong> — your
            email address, a Firebase user ID, when the account was created, your
            chosen career field, and your access tier.
          </li>
          <li>
            <strong className="font-semibold text-ink">Your resume</strong> — the
            PDF you upload and a Markdown conversion of it. In practice this
            contains your name, contact details, employment history, and
            education, because that is what a resume is. This is the most
            sensitive thing the service holds.
          </li>
          <li>
            <strong className="font-semibold text-ink">Applications</strong> — job
            titles, companies, locations, salary, posting URLs and descriptions,
            status, where you found the role, dates, your private notes, your
            follow-ups, and your status timeline.
          </li>
          <li>
            <strong className="font-semibold text-ink">Contacts</strong> — names,
            job titles, LinkedIn URLs, phone numbers, email addresses, and your
            notes about recruiters and hiring managers. See the separate section
            below.
          </li>
          <li>
            <strong className="font-semibold text-ink">AI output</strong> — the
            resume analyses, tailored resumes, cover letters, application answers,
            and LinkedIn notes generated for you, including any edits you make.
          </li>
          <li>
            <strong className="font-semibold text-ink">Support messages</strong> —
            the text you send when requesting premium access.
          </li>
          <li>
            <strong className="font-semibold text-ink">Technical data</strong> —
            your IP address, used to rate-limit abusive traffic and present in
            server logs. Server error logs are deliberately written so they do not
            contain your notes, contacts, or resume text.
          </li>
          <li>
            <strong className="font-semibold text-ink">Usage analytics</strong> —
            aggregate page views and performance timings via Vercel Web Analytics
            and Speed Insights. These are cookie-free and do not build a profile
            of you or follow you to other sites.
          </li>
        </LegalList>
        <p>
          We do not collect payment details, we do not run advertising, and we do
          not sell or share your personal information for cross-context behavioral
          advertising (as those terms are used in the California Consumer Privacy
          Act).
        </p>
      </LegalSection>

      <LegalSection heading="Why we use it, and on what legal basis">
        <LegalList>
          <li>
            To run the service you signed up for — storing your applications,
            generating documents from your resume, and sending the reminders you
            enabled. <em>Basis: performance of a contract.</em>
          </li>
          <li>
            To keep the service working and defend it against abuse — rate
            limiting, attestation, and error logging.{" "}
            <em>Basis: legitimate interests.</em>
          </li>
          <li>
            To send the daily reminder digest. You can turn this off at any time
            in Settings or from the unsubscribe link in any digest.{" "}
            <em>Basis: performance of a contract, and consent where required.</em>
          </li>
          <li>
            To understand aggregate usage and performance.{" "}
            <em>Basis: legitimate interests.</em>
          </li>
        </LegalList>
        <p>
          Your resume and job postings are sent to an AI provider only when you
          click a button that generates something. Nothing is sent for analysis in
          the background.
        </p>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <p>
          We do not sell your data. We use the following service providers
          (&ldquo;sub-processors&rdquo;), each of which only receives what it
          needs:
        </p>
        <LegalList>
          <li>
            <strong className="font-semibold text-ink">Amazon Web Services</strong>{" "}
            (US, Ohio region) — hosts the database, the file storage holding your
            resumes, the API server, and sends the reminder emails.
          </li>
          <li>
            <strong className="font-semibold text-ink">Google (Firebase)</strong>{" "}
            (US) — handles sign-in, password resets, and email verification.
            Google holds your email address and authentication records.
          </li>
          <li>
            <strong className="font-semibold text-ink">Anthropic</strong> (US) —
            receives your resume text and the job posting when you generate
            resume tips, a tailored resume, a cover letter, an application answer,
            or a LinkedIn note. Anthropic does not use data submitted through its
            commercial API to train its models.
          </li>
          <li>
            <strong className="font-semibold text-ink">Vercel</strong> (US) — hosts
            the web front end and provides the cookie-free analytics described
            above.
          </li>
          <li>
            <strong className="font-semibold text-ink">Google Maps Platform</strong>{" "}
            (US) — powers location autocomplete. What you type into a location
            field is sent to Google to fetch suggestions.
          </li>
        </LegalList>
        <p>
          We may also disclose data if legally required to, or to establish or
          defend legal claims. If the service ever changes hands, you will be told
          before your data moves.
        </p>
      </LegalSection>

      <LegalSection heading="Information about other people">
        <p>
          The Contacts feature lets you save details about recruiters, hiring
          managers, and referrals — people who have not signed up for{" "}
          {SERVICE_NAME} and may not know their details are stored here. This is
          the one place where you put someone else&rsquo;s personal data into the
          service.
        </p>
        <p>
          Where data-protection law applies, you are the controller of those
          details and we process them on your behalf. Only save what you actually
          need for your job search, keep your notes professional and factual, and
          delete a contact once the application is over. Deleting an application
          deletes its contacts with it, and deleting your account deletes all of
          them.
        </p>
        <p>
          If you are one of those contacts and want your details removed, write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          and we will find and delete them.
        </p>
      </LegalSection>

      <LegalSection heading="Where your data is held">
        <p>
          All of it is stored in the United States. If you are in the EU, the UK,
          or another region with data-transfer rules, using the service involves
          transferring your data to the US. Our providers rely on the European
          Commission&rsquo;s Standard Contractual Clauses and equivalent UK
          safeguards for those transfers.
        </p>
      </LegalSection>

      <LegalSection heading="How long we keep it">
        <LegalList>
          <li>
            Account data, applications, contacts, resumes, and generated documents
            are kept until you delete them or delete your account.
          </li>
          <li>
            Deleting your account removes your database records and your stored
            resume files immediately and permanently. It cannot be undone and we
            cannot recover it afterwards.
          </li>
          <li>
            Server logs rotate on a fixed schedule and are not used to reconstruct
            deleted accounts.
          </li>
          <li>
            Backups may hold a copy for a short period after deletion before they
            age out on their own schedule.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          Two of these work immediately from{" "}
          <strong className="font-semibold text-ink">Settings</strong>, without
          asking us:
        </p>
        <LegalList>
          <li>
            <strong className="font-semibold text-ink">Get a copy</strong> —
            &ldquo;Download your data&rdquo; produces a JSON file with your
            applications, contacts, notes, generated documents, and resume text.
          </li>
          <li>
            <strong className="font-semibold text-ink">Delete everything</strong> —
            &ldquo;Delete account&rdquo; erases your data and your sign-in.
          </li>
        </LegalList>
        <p>
          You also have the right to correct inaccurate data, to object to or
          restrict certain processing, to withdraw consent, and — if you are in
          the EEA or UK — to complain to your local data protection authority.
          California residents have the rights to know, delete, correct, and to
          non-discrimination for exercising them; we do not sell or share personal
          information, so there is nothing to opt out of. Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          for anything not covered by the two buttons above. We aim to respond
          within 30 days.
        </p>
      </LegalSection>

      <LegalSection heading="Email">
        <p>
          The only marketing-style email we send is the daily reminder digest, and
          only when you have follow-ups due or unsubmitted applications. Every
          digest carries an unsubscribe link and our postal address, and you can
          also switch it off in Settings. Account emails — password resets and
          email verification — are not promotional and are sent regardless.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          Traffic is encrypted in transit. The database is not reachable from the
          internet, stored files are encrypted at rest, and every request is
          checked against the account that owns the record. Production holds no
          static cloud credentials. No system is perfectly secure, and we cannot
          guarantee absolute security — but if a breach affects your data we will
          tell you and any required regulator without undue delay.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>
          {SERVICE_NAME} is not intended for anyone under 16, and we do not
          knowingly collect their data. If you believe a child has created an
          account, email us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If this policy changes in a way that materially affects you, we will
          update the date at the top and notify you by email or in the app before
          the change takes effect.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
