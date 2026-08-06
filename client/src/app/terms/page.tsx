import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { LegalList, LegalSection } from "@/components/LegalPage";
import {
  CONTACT_EMAIL,
  GOVERNING_STATE,
  MAILING_ADDRESS,
  SERVICE_NAME,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The agreement between you and ${SERVICE_NAME}.`,
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={`These terms are the agreement between you and ${SERVICE_NAME}. By creating an account or using the service, you accept them. If you do not, please do not use the service.`}
    >
      <LegalSection heading="1. The service">
        <p>
          {SERVICE_NAME} helps you track job applications and uses AI to generate
          drafts — resume feedback, tailored resumes, cover letters, application
          answers, and LinkedIn notes — from a resume you upload and a job posting
          you save.
        </p>
        <p>
          It is provided free of charge. Basic accounts have a daily cap on AI
          generations; premium access is granted at our discretion on request. We
          may change, limit, or discontinue any feature at any time.
        </p>
      </LegalSection>

      <LegalSection heading="2. Your account">
        <p>
          You must be at least 16 years old. Keep your password to yourself — you
          are responsible for what happens under your account. Give us an email
          address you actually control, since it is how we reach you and how
          account recovery works. Tell us promptly if you think someone else has
          access.
        </p>
        <p>One account per person. Do not share it or transfer it.</p>
      </LegalSection>

      <LegalSection heading="3. AI-generated content — read this one">
        <p>
          The documents this service generates are <strong>drafts</strong>. Large
          language models produce fluent text that can still be wrong: they can
          misstate a date, overstate an achievement, misread a job posting, or
          phrase something in a way you would not stand behind in an interview.
        </p>
        <p>
          You are sending this material to real employers under your own name, so:
        </p>
        <LegalList>
          <li>
            <strong className="font-semibold text-ink">
              Read and verify everything before you send it.
            </strong>{" "}
            You are solely responsible for the accuracy of anything you submit to
            an employer, whether or not this service drafted it.
          </li>
          <li>
            We make no promise that the output is accurate, complete, suitable for
            a particular application, or free of bias.
          </li>
          <li>
            We make no promise about outcomes. Nothing here is a guarantee of
            interviews, offers, or employment.
          </li>
          <li>
            Nothing generated here is legal, financial, immigration, or career
            advice.
          </li>
        </LegalList>
        <p>
          As between you and us, you own the content you upload and the drafts
          generated for you, and you are free to use them however you like. You
          grant us only the limited licence needed to store, process, and display
          that content in order to run the service for you.
        </p>
      </LegalSection>

      <LegalSection heading="4. Your content and your responsibilities">
        <p>
          You confirm that you have the right to upload what you upload, and that
          your resume and application details are truthful. Do not upload anyone
          else&rsquo;s resume as though it were your own.
        </p>
      </LegalSection>

      <LegalSection heading="5. Details you save about other people">
        <p>
          The Contacts feature stores names, phone numbers, email addresses, and
          notes about recruiters and hiring managers — people who have not agreed
          to anything here. Where data-protection law applies, you are the
          controller of those details and we process them for you.
        </p>
        <p>You agree that you will:</p>
        <LegalList>
          <li>
            only save contact details you obtained legitimately in the course of
            your own job search;
          </li>
          <li>
            keep notes factual and professional, and save no more than you need;
          </li>
          <li>
            delete a contact when you no longer need them; and
          </li>
          <li>
            handle any request from that person to see or delete their details,
            with our help if you ask for it.
          </li>
        </LegalList>
        <p>
          You are responsible for your use of that data. Do not use it to send
          bulk or unsolicited messages, or for anything unrelated to your own job
          search.
        </p>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <p>You agree not to:</p>
        <LegalList>
          <li>
            use the service to break the law, infringe someone&rsquo;s rights, or
            harass anyone;
          </li>
          <li>
            attempt to access another user&rsquo;s account or data, or to probe,
            scan, or test the security of the service without our written
            permission;
          </li>
          <li>
            scrape the service, hit the API with automated tools, or work around
            rate limits, quotas, or the AI usage cap;
          </li>
          <li>
            attempt to manipulate the AI features into producing harmful,
            deceptive, or infringing content, including by planting instructions
            in a job posting or resume;
          </li>
          <li>
            upload malware, or anything designed to disrupt the service or the
            infrastructure it runs on;
          </li>
          <li>
            resell the service or use it to build a competing product.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection heading="7. Third-party services">
        <p>
          The service depends on providers listed in our{" "}
          <Link href="/privacy" className="text-brand hover:underline">
            Privacy Policy
          </Link>
          , and links out to job boards and other sites we do not control. We are
          not responsible for those services or for what happens on them.
        </p>
      </LegalSection>

      <LegalSection heading="8. Availability">
        <p>
          The service runs on modest infrastructure and is offered as-is. There is
          no uptime commitment, and it may be unavailable for maintenance, a
          provider outage, or no reason at all. Keep your own copies of anything
          you would be upset to lose — Settings has a one-click export.
        </p>
      </LegalSection>

      <LegalSection heading="9. Ending your access">
        <p>
          You can delete your account at any time from Settings. That erases your
          data permanently and immediately, and it cannot be reversed.
        </p>
        <p>
          We may suspend or terminate an account that breaches these terms, that
          is being used to harm the service or another user, or where we are
          required to. Where it is reasonable to do so, we will give notice and a
          chance to export first.
        </p>
      </LegalSection>

      <LegalSection heading="10. Disclaimer of warranties">
        <p>
          To the fullest extent permitted by law, the service is provided
          &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of
          any kind, express or implied — including any implied warranties of
          merchantability, fitness for a particular purpose, non-infringement, or
          that the service will be uninterrupted, secure, or error-free.
        </p>
        <p>
          Some jurisdictions do not allow the exclusion of implied warranties, so
          parts of this section may not apply to you.
        </p>
      </LegalSection>

      <LegalSection heading="11. Limitation of liability">
        <p>
          To the fullest extent permitted by law, we will not be liable for
          indirect, incidental, special, consequential, or punitive damages, or for
          lost profits, lost opportunities, lost employment, or lost or corrupted
          data, arising out of or relating to your use of the service.
        </p>
        <p>
          Our total liability for all claims relating to the service will not
          exceed one hundred US dollars ($100), or the amount you paid us in the
          twelve months before the claim — whichever is greater. The service is
          currently free, so in most cases this is $100.
        </p>
        <p>
          Nothing here limits liability that cannot be limited by law, including
          for fraud or for death or personal injury caused by negligence. Some
          jurisdictions do not allow certain limitations, so parts of this section
          may not apply to you.
        </p>
      </LegalSection>

      <LegalSection heading="12. Indemnity">
        <p>
          You agree to indemnify and hold us harmless from claims, losses, and
          reasonable legal costs arising out of your misuse of the service, your
          breach of these terms, or your handling of other people&rsquo;s personal
          data through the Contacts feature.
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to these terms">
        <p>
          We may update these terms. If a change materially affects your rights, we
          will update the date at the top and notify you by email or in the app
          before it takes effect. Continuing to use the service after that means
          you accept the new terms; if you do not, delete your account.
        </p>
      </LegalSection>

      <LegalSection heading="14. Governing law">
        <p>
          These terms are governed by the laws of the State of {GOVERNING_STATE},
          without regard to its conflict-of-laws rules. You and we agree to the
          exclusive jurisdiction of the state and federal courts located in{" "}
          {GOVERNING_STATE} for any dispute, except that either of us may seek
          injunctive relief in any court with jurisdiction. If you are a consumer
          in the EEA or UK, this does not deprive you of the protections of your
          local law or of your right to bring proceedings where you live.
        </p>
      </LegalSection>

      <LegalSection heading="15. General">
        <p>
          If any provision is held unenforceable, the rest stays in force. Our not
          enforcing a provision is not a waiver of it. These terms and the Privacy
          Policy are the entire agreement between us about the service. You may not
          assign them; we may, to a successor of the service.
        </p>
      </LegalSection>

      <LegalSection heading="16. Contact">
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand hover:underline">
            {CONTACT_EMAIL}
          </a>
          , or by post to {MAILING_ADDRESS}.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
