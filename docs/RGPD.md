# GDPR: register, candidate notice, requests

What a customer organisation needs to use Vivier lawfully: who is who,
the register of processing to complete, the notice to give candidates
(French and English), and the procedure for a candidate's request using
the product's own actions. Facts about the product come from the code
(`supabase/migrations`, `src/lib`, `services/processor`); the legal
qualifications are a template for the organisation and its DPO or
counsel to confirm, not advice. Paths are relative to `vivier/`.

## Who is who

| Party                              | Role                        | Notes                                                                                                                                     |
| ---------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The customer organisation          | Controller                  | Decides to collect CVs, for which positions, how long they are kept (`organizations.retention_months`), who in the team sees them.        |
| The publisher of Vivier            | Processor (candidate data); controller (user accounts) | Acts on the organisation's instructions through the product; a data processing agreement binds it. Controller for the accounts of the organisation's users (email, name, language, activity). |
| Supabase                           | Sub-processor               | Database, authentication, file storage (the CVs, the photos), realtime; project in the EU region chosen at creation.                       |
| Cloudflare                         | Sub-processor               | Runs the web application (Workers, global edge) and holds the backups (R2 bucket, EU jurisdiction, thirty-day retention).                |
| Railway                            | Sub-processor               | Runs the processor (reads the PDFs, structures them, runs the retention purge).                                                           |
| The model vendor                   | Sub-processor               | Mistral by default (EU); any OpenAI-compatible vendor the organisation's deployment chooses. Receives, for the duration of each call: the CV's text (structuring, and the classification that sets aside what is not a CV), a brief's title and text (its one reading into a role profile and requirements), the profile's compact text (embeddings), for the triage of an analysis a compact card of each profile of the pool (the headline, the positions held, the years, the first degree, the first skills) with no identity, no contact details, no location, no link and no photo, the name and the place taken out of its texts (`triageCard()`), and for the assessment (and a dossier draft reworded by the model, an option no screen asks for since evolution 6) a profile with the name, e-mail addresses and phone numbers removed from every text. Never the photo. A deployment may name a second model of the same vendor for the assessment (`LLM_ASSESSMENT_MODEL`). No training on the data (to be confirmed in the vendor's terms). |
| Mistral (OCR)                      | Sub-processor, when enabled | Receives scanned PDFs to read their text.                                                                                                  |
| Resend                             | Sub-processor               | Sends invitations to the organisation's users and shared shortlists to the addresses the organisation enters (hiring managers). Never emails a candidate. |
| Hiring managers                    | Recipients                  | Open a shared page by link: a snapshot of the retained candidates, expiring, revocable, with CVs when the team chose to include them; never a photo. |

## Register of processing: "Recruitment talent pool"

One activity, to copy into the organisation's register (Art. 30) and
complete where brackets appear.

| Item                               | Content                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controller                         | [Organisation, address, representative]; DPO: [name, address, email] when one is appointed.                                                                                                                                                                                                                                                                                                                 |
| Purpose                            | Receiving and keeping applications (spontaneous or for a position), finding in the pool the candidates who answer a brief, deciding as a team whom to contact, presenting a shortlist to the hiring manager.                                                                                                                                                                                                 |
| Legal basis                        | Steps prior to a contract at the candidate's request (Art. 6(1)(b)) for the position applied for; the organisation's legitimate interest in recruiting (Art. 6(1)(f)) for keeping an application in the pool for a bounded time, with the information below given to the candidate; the candidate's consent (Art. 6(1)(a)) when the organisation chooses to ask for it, recorded as `consent_status = given` with its date, withdrawable at any time (`withdrawn`: the profile and its files are deleted within the hour). |
| Data subjects                      | Candidates (anyone whose CV the organisation uploads or whose profile it types in); the organisation's users (members of the team).                                                                                                                                                                                                                                                                         |
| Categories of data: candidates     | Identity (name), contact (email, phone, links such as a portfolio), current title, location, years of experience, availability, a summary, skills, languages and levels, experiences (title, company, dates, description), education (degree, school, year), tags given by the team; the CV file as uploaded and the text read from it; the model's reading with a confidence per field; the team's messages about them (the thread beside their profile, the thread of each of their shortlist entries, and the brief threads that name them), decisions and assignments (votes and notes written before evolution 6 stay in their table and column, which nothing writes any more); consent status and date, last contact date; the triage's verdict on each profile's métier for an analysis of the whole pool, with its short reason (`search_triage`, deleted with the candidate or the analysis); the explained match against each brief (verdicts and the evidence quoted from the CV) and, with a model, its assessment (a reading fit / borderline / no fit, a score 0..100, two to four sentences, one row per requirement with the evidence quoted from the CV), kept with the analysis (`searches.results`), the shortlist item (`shortlist_items.match`) and the dossier sent (`shares.items`); the kind the processor gave each document (`cv`, `other`); the photo on the CV's first page, when there is one, kept as a small image file to identify the person in the interface (`candidates.photo_path`, the private `photos` bucket): shown to the team's members next to the name, never to the model, never on the dossier a hiring manager opens, and hidden for the whole organisation when it chooses so (`organizations.show_photos`, for a team that practises anonymous CVs). A document set aside as not a CV keeps its file and its text, attached to no candidate, until it is deleted. |
| Data explicitly excluded           | Age, date of birth, gender, nationality or origin, family situation, health, religion, union membership, political opinions, sexual orientation: never extracted into a profile, never accepted as a criterion of a brief (a request naming one is dropped by the brief's reading and counted in the log, never stored), never mentioned in the model's assessments or dossier drafts (the prompts forbid it, and the assessment receives neither the name nor the contact details). The photo is kept as a file for identification (the row above) and for nothing else: not a field, not a criterion, not sent to the model, nothing read or inferred from it. The CV file itself is kept as the candidate sent it and may contain such data (a date of birth, a family situation): it is read by the members who open it and by the model during structuring, not stored as fields. The organisation's notice tells candidates not to include them. |
| Categories of data: users          | Email, display name, language, role in the organisation, actions in the organisation (`activities`), sessions.                                                                                                                                                                                                                                                                                              |
| Recipients                         | The organisation's members by role (viewers read; members write; administrators delete and erase; owners manage). The sub-processors above. Hiring managers through a dossier page (expiring, revocable, a snapshot of the retained candidates with the requirement table, the score and the decision of the assessment, and the brief's requirements; CVs through links valid two minutes; no photo). |
| Transfers outside the EU           | None with the default deployment (Supabase EU region, Cloudflare EU jurisdiction for backups, Mistral). Cloudflare Workers run at the edge nearest the user and keep no candidate data at rest. If the organisation's deployment chooses a vendor outside the EU (e.g. OpenAI, United States), the vendor's data processing terms and transfer mechanism (standard contractual clauses) apply and the notice is updated. |
| Retention                          | Set by the organisation, 1 to 24 months after the last contact (24 by default, the ceiling the CNIL recommends for a recruitment pool); an hourly purge deletes the candidate and their files (the CVs, the photo) when the date is past, or at once when consent is withdrawn; the profile page shows the date. Backups: thirty days after deletion at most. Audit log (`activities`): kept with the organisation (a deletion leaves a line naming the deleted candidate). Shared pages: until their expiry or revocation (a snapshot; see "Requests"). User accounts: until the person deletes theirs; an organisation deleted by its owner takes everything with it. |
| Security measures                  | Row Level Security on every table with the role as the only key; server-side checks of the caller's token and role before any privileged action; secrets in the hosting dashboards only, never in the code or the browser; TLS everywhere; encryption at rest by Supabase and Cloudflare; CV files and photos in private buckets, opened through signed links of five minutes (members; fifteen in the CV viewer, ten for a photo) or two minutes (shared pages, CVs only); share and invitation links as random tokens stored hashed; rate limits on every costly action; the assessment sends the model a profile stripped of its name and contact details; an audit log of actions written by the database; nightly backups with a thirty-day retention and a rehearsed restore; no automated decision; sensitive data excluded by design. |
| Automated decision-making (Art. 22) | None. The model structures CVs, reads the brief once into a role profile and requirements (from the consultant's text alone; no person edits them, and the requirements are shown with each profile's reading), sorts every profile of the pool by métier from a card without identity, location or photo (a thin card is read in full, never dropped), and assesses each profile it kept against those requirements with a reading (fit, borderline, no fit) that rules bound in the code: a requirement the CV says nothing about is "not stated", never a lack; a "no" the model cannot quote becomes "not stated"; a required requirement the CV is silent about leaves the profile "to check" at most. The analysis lists only the matching profiles; every profile set aside (by the triage on the métier or after the full reading) stays viewable on demand with its reason, from the analysis's own figures; every screen that shows the model's reading marks it as such, once ("Lecture du modèle"). A person decides: every retain or dismiss is a person's, recorded with their identity and the moment. The organisation's users are told so on every page, and the dossier's footer says so to the hiring manager. |
| Impact assessment (Art. 35)        | [To decide with the DPO.] Large-scale processing of applicants' data with a ranking step is a reason to carry one out; this register and `docs/ARCHITECTURE.md` provide its technical part.                                                                                                                                                                                                                 |

## Candidate information notice

To give at the moment of collection (the application form, the job
advert, the acknowledgement email) or, for a CV received by other means,
within a month of its upload at the latest. Replace the brackets. Both
languages say the same thing.

### Français

> **Information sur le traitement de votre candidature**
>
> [Organisation], [adresse], traite les données de votre candidature
> (identité, coordonnées, parcours, formation, compétences, langues,
> localisation, disponibilité, et le CV que vous nous avez envoyé) pour
> étudier votre candidature au poste visé et, pendant une durée limitée,
> pour vous proposer d'autres postes correspondant à votre profil.
>
> Ce traitement repose sur les mesures précontractuelles prises à votre
> demande et sur notre intérêt légitime à recruter [et, si nous vous l'avons
> demandé, sur votre consentement, que vous pouvez retirer à tout moment].
>
> Nous utilisons le logiciel Vivier pour gérer notre vivier de candidats.
> Le texte de votre CV est transmis à un fournisseur de modèle de langage
> ([Mistral AI, hébergé dans l'Union européenne]) pour en extraire une fiche
> structurée et pour évaluer, exigence par exigence et en quelques phrases,
> la correspondance entre votre profil et un poste ; cette évaluation ne
> reçoit ni votre nom ni vos coordonnées. Le modèle ne prend aucune
> décision : il structure, évalue et explique ; chaque décision est prise
> par une personne de notre équipe et tracée. Le fournisseur n'utilise pas vos données pour
> entraîner ses modèles. Aucune donnée sensible (âge, date de naissance,
> genre, origine, situation familiale, santé, religion, syndicat,
> opinions politiques) n'est extraite ni utilisée comme critère ; nous vous
> invitons à ne pas en faire figurer dans votre CV. Si votre CV comporte
> une photo, elle est conservée avec lui pour vous identifier dans
> l'interface de notre équipe ; elle n'est jamais transmise au fournisseur
> de modèle, ne figure pas dans le dossier envoyé aux responsables du
> recrutement et n'entre dans aucun critère.
>
> Vos données sont accessibles aux membres de notre équipe de recrutement,
> à nos sous-traitants techniques (hébergement de l'application et des
> fichiers dans l'Union européenne, envoi d'emails, fournisseur de modèle)
> et, sous la forme d'un dossier à durée limitée (votre fiche, l'évaluation
> exigence par exigence, votre CV), aux responsables du recrutement
> concernés.
>
> Vos données sont conservées [24] mois après notre dernier contact, puis
> supprimées automatiquement avec votre CV. Les sauvegardes sont effacées
> au plus tard trente jours après cette suppression.
>
> Vous disposez d'un droit d'accès, de rectification, d'effacement, de
> limitation, d'opposition et de portabilité, et du droit de retirer votre
> consentement. Pour l'exercer, écrivez à [adresse email], [ou au DPO :
> adresse]. Vous pouvez introduire une réclamation auprès de la CNIL
> (www.cnil.fr).

### English

> **How we process your application**
>
> [Organisation], [address], processes the data of your application
> (identity, contact details, career, education, skills, languages,
> location, availability, and the CV you sent us) to consider you for the
> position you applied to and, for a limited time, to offer you other
> positions matching your profile.
>
> This processing rests on the steps taken at your request before a
> contract and on our legitimate interest in recruiting [and, where we
> asked for it, on your consent, which you may withdraw at any time].
>
> We use the Vivier software to manage our talent pool. The text of your
> CV is sent to a language-model vendor ([Mistral AI, hosted in the
> European Union]) to extract a structured profile and to assess, requirement
> by requirement and in a few sentences, how your profile matches a
> position; that assessment receives neither your name nor your contact
> details. The model makes no decision: it structures, assesses and
> explains; every decision is made by a person on our team and recorded.
> The vendor does not use your data to
> train its models. No sensitive data (age, date of birth, gender, origin,
> family situation, health, religion, union membership, political
> opinions) is extracted or used as a criterion; please leave such data
> out of your CV. If your CV carries a photo, it is kept with it to
> identify you in our team's interface; it is never sent to the model
> vendor, does not appear in the dossier sent to hiring managers and
> enters no criterion.
>
> Your data is accessible to the members of our recruiting team, to our
> technical processors (hosting of the application and files in the
> European Union, email sending, the model vendor) and, as a time-limited
> dossier (your profile, the requirement-by-requirement assessment, your
> CV), to the hiring managers concerned.
>
> Your data is kept for [24] months after our last contact, then deleted
> automatically together with your CV. Backups are erased at most thirty
> days after that deletion.
>
> You have the right to access, rectify, erase, restrict, object to and
> port your data, and to withdraw your consent. To do so, write to [email
> address] [or to the DPO: address]. You may lodge a complaint with your
> supervisory authority (in France, the CNIL, www.cnil.fr).

## Requests from a candidate

The organisation answers within one month (Art. 12; extendable by two
months for complex requests, the candidate being told why), after a
reasonable check of the requester's identity (reply to the address held
in the profile, or ask for proof when the request comes from elsewhere).
Keep a log of requests and answers outside the product (the product logs
the actions, not the correspondence).

**Find the candidate**: `/app/candidates`, search by name, then
"Afficher les archivés" in the filters if nothing shows; the email in the profile confirms it is the
right person. A candidate uploaded twice is one profile (the processor
merges by email, by phone number and by fingerprint), but check for a
second row typed in by hand, or one the processor refused to merge because
the names disagreed (`dedup_name_conflict` in its log): search by email as
well as by name, and open **Similar profiles** on the page found.

| Request                     | What to do in Vivier                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access, portability (Art. 15, 20) | On the profile page, **Export**: one JSON file built from the profile and its documents (the structured fields, the confidences, the consent and dates, the text read from each CV) and, when the profile carries a photo, a link to it valid one hour (`photo`: save the image with the file before the link expires; the file says so without the link when it could not be signed). Add the CV files themselves (Documents card → **Read**, then download) and, when the candidate asks, the team's messages about them (the Discussion beside their profile and the thread of each of their shortlist entries; a brief's thread may name them too: read it). Send the file, the CVs and a copy of the notice above, which lists the purposes, recipients and retention. Internal notes about the candidate are their data too; a comment about a colleague's opinion is not. |
| Rectification (Art. 16)     | Edit the profile (a member): every field the structuring read can be corrected; the correction is kept over any later reading unless a new CV is uploaded with a confident value. Tell the candidate what was changed.                                                                                                                                                                                                                 |
| Erasure (Art. 17)           | An administrator opens the profile and chooses **Erase**, types the candidate's name and confirms. The server removes the CV files and the photo from storage first, then the profile; shortlist entries and the messages on the candidate and on those entries go with it (database cascade); a message on a brief's thread that names the candidate stays with the brief: read the threads of the briefs they were analysed for and delete by hand what names them; the audit log keeps one line, `candidate.deleted`, with the name and who erased. Then revoke any **share** that includes the candidate (the brief's Shortlist tab lists its shares under the board, a revocation in each row's menu), because a share is a snapshot of what was sent. Answer the candidate that the data is erased and that backups are purged within thirty days. |
| Withdrawal of consent       | On the profile page, **Consent → withdrawn** (confirmed first). The hourly purge then deletes the profile, its files and its photo; the erasure steps above do it at once when the candidate asks for immediacy.                                                                                                                                                                                                                                 |
| Objection, restriction (Art. 18, 21) | **Archive** the candidate (status `archived`): archived profiles are out of every search and shortlist addition while the request is examined, and the team sees the status on the profile. Note the reason in the candidate's thread. Then erase or reactivate.                                                                                                                                                                             |
| Information about the model | Point to the notice above: which vendor (the deployment's `LLM_BASE_URL`, shown by name on `/status`), what is sent (the CV text, the brief, the profile, and for the triage a card with no identity or location; never the photo), what comes back (a structured profile with confidences, explanations), and that no decision is automated.                                                                                                                                                                      |

**Documents set aside** (`rejected`): a file the model did not take for a
CV (a cover letter alone, a diploma, an identity document or a payslip
uploaded by mistake) keeps its file in the bucket and its text in the row,
with the sentence saying why, attached to no candidate unless it was
uploaded from a profile page. Nothing purges it: the retention pass
removes candidates and their documents only, and no page offers to delete
it yet (an administrator deletes it through the API, the `documents:
admins delete` policy). When such a file holds a person's data the pool
has no reason to keep, delete it as soon as it is noticed and record it.

**What erasure leaves, said honestly** (so the answer to the candidate is
exact):

- `activities`: one line `candidate.deleted` with the candidate's name
  and the person who erased; earlier lines about the candidate keep their
  id, not their name.
- `comments` on a brief: a message of a brief's thread that names the
  candidate in its words stays, since it belongs to the brief; its
  author or an administrator deletes it by hand.
- `searches.results`: the stored results of past analyses keep, for each
  candidate id, the verdicts and the evidence quoted from the CV at the
  time (a skill, a language, a snippet) and, with a model, the assessment
  (its sentences, its score, one row per requirement with its quote). The
  id no longer resolves to a profile; the text remains. A deployment that must remove them runs,
  with the service role, an update of `searches.results` dropping the
  entries whose `candidateId` is the erased one (a later evolution should
  do this inside `eraseCandidate`).
- `shares.items`: the snapshot of a dossier that included the candidate
  (name, headline, location, years, availability, skills, languages,
  synthesis, strengths, attention, the score, the decision and the
  requirement table with its quotes) stays in the row until the share is
  deleted; revoking makes the page unreachable. The same later evolution
  should scrub the item from `items` on erasure.
- Backups: the nightly dump taken before the erasure holds the data for
  up to thirty days; the bucket mirror moves the CV into a dated deleted
  set, removed thirty days later (`docs/BACKUPS.md`). The photo is in no
  backup (the `photos` bucket is not mirrored): it is gone with the
  erasure.
- Emails already sent to hiring managers (a shared page) are in their
  inboxes; the page they link to is revoked.

**Reply template** (to adapt):

> Nous avons bien reçu votre demande du [date] concernant vos données.
> [Accès : vous trouverez ci-joint l'export de votre fiche et vos CV.]
> [Effacement : votre fiche, vos CV et les échanges internes vous
> concernant ont été supprimés le [date] ; les sauvegardes sont purgées
> sous trente jours ; les présentations partagées qui vous incluaient ont
> été révoquées.] [Rectification : les champs [liste] ont été corrigés.]
> Pour toute question, [contact]. Vous pouvez introduire une réclamation
> auprès de la CNIL.

## Users of the organisation

The organisation's own users are the publisher's data subjects: they
read the product's privacy policy (`/privacy`), change their name and
language on `/app/settings` ("Mon compte"), and delete their account
there (`delete_my_account()`: organisations they own alone go with it,
their memberships elsewhere are removed, their messages and decisions
keep their id with no name: a thread then shows "Un ancien membre"). The activity log of an organisation names its
members by their display name while they are members.
