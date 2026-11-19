/**
 * The skill library: short lines of guidance for the ready-made assistants,
 * grouped by the kind of work. A skill is never a permission. It only says how
 * to do a kind of task with what the app already allows: reading the folders
 * the person picked and saving new files there, reading web pages after the
 * person approves the site, the connections and mail the person ticks, asking
 * another assistant, and looking at the screen when allowed.
 *
 * Only the guidance of the skills an assistant has ticked goes into its
 * instructions, so each one stays a few short lines.
 */

/** The kinds of work. The gallery files personas under the same headings. */
export const CATEGORIES = [
  { id: "code", name: "Code and product" },
  { id: "business", name: "Business and sales" },
  { id: "money-law", name: "Money and law" },
  { id: "writing", name: "Writing and media" },
  { id: "learning", name: "Research and learning" },
  { id: "design", name: "Design and making" },
  { id: "everyday", name: "Everyday" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];

/** The headings the skills picker groups skills under, in this order. */
export const SKILL_GROUPS = [
  { id: "general", name: "General" },
  ...CATEGORIES,
] as const;
export type SkillGroupId = (typeof SKILL_GROUPS)[number]["id"];

export interface Skill {
  id: string;
  name: string;
  /** One line for the picker. */
  description: string;
  group: SkillGroupId;
  /** What goes into the assistant's instructions when the skill is ticked. */
  guidance: string;
}

/** The most skills one assistant keeps; a save takes no more. */
export const MAX_SKILLS = 20;
/** The longest a skill's guidance may be, so instructions stay small. */
export const MAX_GUIDANCE = 320;
/** The longest a skill's one-line description may be. */
export const MAX_DESCRIPTION = 90;

function skill(
  group: SkillGroupId,
  id: string,
  name: string,
  description: string,
  guidance: string,
): Skill {
  return { id, name, description, group, guidance };
}

export const LIBRARY_SKILLS: Skill[] = [
  // Code and product
  skill(
    "code",
    "find-root-cause",
    "Find the root cause",
    "Work from the exact error to its cause before suggesting a fix.",
    "For a bug, ask for the exact error text and the steps that cause it. Test one guess at a time and say what would confirm it. Fix the cause, not the symptom, and say what you could not check.",
  ),
  skill(
    "code",
    "test-plan",
    "Plan and write tests",
    "Decide what to test by risk, then write focused tests.",
    "For tests, rank what to test by risk first. Prefer many small unit tests, fewer integration tests and only the key end-to-end paths. Each test checks one behaviour, gives the same result every run, and its name says what it proves.",
  ),
  skill(
    "code",
    "safe-refactor",
    "Refactor safely",
    "Change the structure of code without changing what it does.",
    "When refactoring, change structure, never behaviour. Work in small steps, keep public names and interfaces unless asked, and say which tests guard each step.",
  ),
  skill(
    "code",
    "code-review",
    "Review code",
    "Find the problems that matter most in a change, with fixes.",
    "When reviewing code, lead with what changes behaviour, loses data or weakens security, then smaller issues. Point to the file and line, say why it matters and suggest a fix. Keep must-fix apart from nice-to-have.",
  ),
  skill(
    "code",
    "technical-choice",
    "Weigh a technical choice",
    "Compare options for a design, a library or a data model.",
    "For a technical decision, lay out two or three options with their cost, risk and what each makes harder later. Recommend one, and say what would change your mind.",
  ),
  skill(
    "code",
    "change-description",
    "Describe a change",
    "Write a clear title and description for a code change.",
    "To describe a code change, write a title that says what changed, then a short summary, the changes, how it was tested and the risks. Never claim a test ran unless it did.",
  ),
  skill(
    "code",
    "stress-test-screen",
    "Stress-test a screen",
    "Try worst-case data on a screen and list what breaks.",
    "To stress-test a screen, try very long and one-letter names, empty fields, zero, one and thousands of items, long translated labels, slow loads and errors. Report each break with a fix.",
  ),
  skill(
    "code",
    "interface-polish",
    "Interface polish",
    "Check focus, keyboard, touch, motion and layout details.",
    "For interface work, check visible focus, full keyboard use, tap targets of at least 44 pixels, labels on every control, reduced motion, and that nothing jumps while loading. Keep motion short and purposeful.",
  ),
  skill(
    "code",
    "clarify-requirements",
    "Clarify requirements",
    "Turn a vague request into scope and acceptance criteria.",
    "For a vague request, write the problem, who it is for, what is in scope, what is not, testable acceptance criteria and up to three open questions. Mark gaps 'to confirm' instead of guessing.",
  ),
  skill(
    "code",
    "write-issue",
    "Write an issue",
    "Draft a well-scoped issue or user story.",
    "An issue has a goal, the context, the scope and acceptance criteria. Keep one issue to one change that can ship on its own.",
  ),
  skill(
    "code",
    "split-work",
    "Split big work",
    "Break a large feature into small pieces that ship on their own.",
    "To split a large feature, cut it into small pieces that can each ship and be checked alone, in a sensible order, each with its own acceptance criteria.",
  ),
  skill(
    "code",
    "prioritise",
    "Prioritise",
    "Rank work by impact, effort and risk against a goal.",
    "To prioritise, rank the work against the stated goal by impact, effort and risk, and fit it to the time or people available. Say what you would cut and why.",
  ),
  skill(
    "code",
    "status-update",
    "Status update",
    "Report progress, blockers and next steps to others.",
    "In a status update, lead with where things stand against the goal, then what is done, in progress, blocked and next. Name risks plainly, and use only facts you were given.",
  ),
  skill(
    "code",
    "weigh-evidence",
    "Weigh the evidence",
    "Say how strong the evidence behind an idea or request is.",
    "For an idea or request, say what evidence backs it: how many people asked, in their own words, and how strong it is. Keep what people said apart from what you infer.",
  ),

  // Business and sales
  skill(
    "business",
    "campaign-brief",
    "Campaign brief",
    "Pin down the goal, audience, message and channels on one page.",
    "Before writing a campaign, agree on one page: the goal, the audience, one main message, the channels, the timeline and how success will be measured.",
  ),
  skill(
    "business",
    "launch-post",
    "Launch post",
    "Draft an announcement for something new.",
    "For a launch, open with what is new and who it helps, add one or two concrete details, and end with one call to action. Write drafts only; the person decides what goes out.",
  ),
  skill(
    "business",
    "social-posts",
    "Social posts",
    "Short posts that fit each network, with options.",
    "For social posts, fit each network's length and tone, keep one idea and one call to action per post, and offer two or three options.",
  ),
  skill(
    "business",
    "changelog",
    "Changelog entry",
    "Turn shipped work into a customer-facing update.",
    "For a changelog, say what customers can now do, in plain words, grouped as new, improved and fixed. Leave out internal names and details.",
  ),
  skill(
    "business",
    "competitor-note",
    "Competitor note",
    "Compare with competitors on what matters to the buyer.",
    "For a competitor note, compare on the few points that matter to the buyer, from sources you can name, with dates. Mark anything you could not confirm.",
  ),
  skill(
    "business",
    "search-keywords",
    "Search keywords",
    "Find the words people search for and pick targets per page.",
    "For search keywords, find the words people really use, group them by intent, and pick one main term and a few related ones per page. Say plainly when you have no real search volume data.",
  ),
  skill(
    "business",
    "account-research",
    "Research an account",
    "Learn about a company before a call or outreach.",
    "To research a company, summarise what it does, its size, recent news and the roles that matter, each with a source and a date. Never invent a person, a need or a past promise.",
  ),
  skill(
    "business",
    "call-prep",
    "Prepare a call",
    "A one-page brief before a sales call or meeting.",
    "To prepare a call, write one page: who attends, the history, one goal for the call, up to five open questions, likely objections and the next step to ask for.",
  ),
  skill(
    "business",
    "follow-up-email",
    "Follow-up message",
    "One short follow-up with one clear ask.",
    "A follow-up goes to one person with one clear ask. Refer to what was said, add one useful thing, and never invent an amount, a discount or a date.",
  ),
  skill(
    "business",
    "answer-objection",
    "Answer an objection",
    "A short, honest reply to a prospect's concern.",
    "To answer an objection, acknowledge the concern, reply honestly and briefly, and end with a question that moves things on. Never promise a feature, a price or a date you were not given.",
  ),
  skill(
    "business",
    "pipeline-review",
    "Review a pipeline",
    "Give every open deal a dated next step and an owner.",
    "To review a pipeline, give each open deal a dated next step and an owner, flag deals that have gone quiet, and set the total against the goal.",
  ),
  skill(
    "business",
    "sales-playbook",
    "Sales playbook",
    "Who you sell to, the steps of a deal and the words to use.",
    "For a sales playbook, describe who you sell to, the steps of a deal and what moves each one forward, the questions to ask and the words to use, in a few pages.",
  ),
  skill(
    "business",
    "customer-reply",
    "Customer reply",
    "Answer one customer clearly, with a next step.",
    "To reply to a customer, restate the problem in their words, give the answer or workaround in numbered steps, and end with one next step. Never promise a refund, a discount or a fix date that was not approved.",
  ),
  skill(
    "business",
    "bug-report",
    "Bug report",
    "Turn a customer's problem into a report a developer can use.",
    "In a bug report, give what the person saw, the steps to reproduce it, what they expected and how many people it affects. Keep facts apart from guesses.",
  ),
  skill(
    "business",
    "help-article",
    "Help article",
    "A help page for a question people keep asking.",
    "For a help article, use a title in the customer's words, give the short answer first, then numbered steps that match how the product really behaves.",
  ),
  skill(
    "business",
    "saved-reply",
    "Saved reply",
    "A reusable reply with placeholders for what changes.",
    "For a saved reply, write a reusable answer with clear placeholders for what changes, such as [name] or [order number], and nothing that only fits one case.",
  ),
  skill(
    "business",
    "triage-queue",
    "Triage a queue",
    "Sort open requests by urgency and impact.",
    "To triage a queue, sort by urgency and impact, tag the common themes, and say which three to answer first and why.",
  ),
  skill(
    "business",
    "incident-update",
    "Incident update",
    "Tell customers what is happening during an outage.",
    "In an incident update, say what is affected, what people can do meanwhile and when the next update comes. Never guess the cause or a fix time.",
  ),
  skill(
    "business",
    "hiring-plan",
    "Hiring plan",
    "Must-haves, interview steps and who decides, before posting.",
    "For a hiring plan, define the must-haves, the nice-to-haves, the interview steps and who decides, before any job post is written.",
  ),
  skill(
    "business",
    "job-description",
    "Job description",
    "Describe a role plainly and inclusively.",
    "In a job description, describe the real work, the must-haves, what is offered and how to apply, in plain, inclusive words. Leave out requirements the job does not need.",
  ),
  skill(
    "business",
    "screen-applications",
    "Screen applications",
    "Sort applications against the must-haves, with reasons.",
    "To screen applications, mark each yes, no or maybe with one reason tied to a must-have. Use only what is written, and never judge on age, health, family, origin or other personal traits.",
  ),
  skill(
    "business",
    "interview-plan",
    "Interview plan",
    "Stages, structured questions and a scorecard.",
    "For an interview plan, set the stages, structured questions tied to the must-haves, a scorecard and who decides. Ask every candidate the same core questions.",
  ),
  skill(
    "business",
    "product-page",
    "Product page",
    "The facts a buyer needs, in words they can scan.",
    "For a product page, give the name, what it is, who it is for and the facts a buyer needs, such as size, material, care and delivery. Use only facts you were given and list what is missing.",
  ),
  skill(
    "business",
    "store-plan",
    "Store plan",
    "What a shop sells, its collections and the pages it needs.",
    "For a store plan, say what the shop sells, how products group into collections, the pages it needs and what is still undecided, on one page.",
  ),
  skill(
    "business",
    "shop-policies",
    "Shipping and returns text",
    "Plain policy text from rules already decided.",
    "For shipping, returns and care text, turn rules the person already decided into plain words. Never invent a time limit or a fee, and ask which country's consumer rules apply.",
  ),
  skill(
    "business",
    "launch-checklist",
    "Launch checklist",
    "Everything that must be done before opening or releasing.",
    "For a launch or release, list what must be done first, such as pages, copy, files, the people to name, policies and checks, each with an owner and a status.",
  ),

  // Money and law
  skill(
    "money-law",
    "sort-expenses",
    "Sort expenses",
    "Put expenses into bookkeeping categories.",
    "To sort expenses, put each line in a bookkeeping category with how sure you are, and list the ones you are unsure about for the person to check.",
  ),
  skill(
    "money-law",
    "read-invoice",
    "Read an invoice",
    "Pull the key fields from an invoice into a table.",
    "To read an invoice, pull out the supplier, number, dates, amounts, tax line, currency and terms into a table. Leave a field empty rather than guess it.",
  ),
  skill(
    "money-law",
    "unusual-spend",
    "Spot unusual spend",
    "Find spikes, duplicates and forgotten subscriptions.",
    "To check spending, look for spikes, duplicate charges, new suppliers and forgotten subscriptions, and explain each in one line.",
  ),
  skill(
    "money-law",
    "month-end",
    "Month-end checklist",
    "What to collect and check at the end of a month.",
    "For a month-end checklist, list receipts to collect, invoices sent and paid, items to reconcile and documents for the accountant.",
  ),
  skill(
    "money-law",
    "payment-reminder",
    "Payment reminder",
    "A polite reminder about an unpaid invoice.",
    "For a payment reminder, be short and polite, and give the invoice number, amount, due date and how to pay. Friendly first; firmer only if the person asks.",
  ),
  skill(
    "money-law",
    "contract-checklist",
    "Contract checklist",
    "The key terms, risks and open questions in a contract.",
    "For a contract, cover the parties and purpose, term and renewal, money, obligations, risk clauses such as liability, ownership, confidentiality and termination, and open questions. Quote the wording and say when a clause is missing.",
  ),
  skill(
    "money-law",
    "legal-research",
    "Research the law",
    "What the rules say for one named country, with sources.",
    "When researching a legal question, answer for one named country, cite each rule's official source and its date, and say what you could not confirm. Never invent a law, a case or a deadline.",
  ),
  skill(
    "money-law",
    "policy-check",
    "Check a policy draft",
    "Find placeholders, mismatches and gaps in a policy.",
    "To check a policy or terms draft, find unfilled placeholders, names that do not match, and missing sections before it is used.",
  ),
  skill(
    "money-law",
    "personal-data-map",
    "Map personal data",
    "Which services receive personal data, what data and why.",
    "To map personal data, list each service that receives it, what data it gets and why, as notes for a privacy review.",
  ),

  // Writing and media
  skill(
    "writing",
    "copy-brief",
    "Copy brief",
    "Agree the reader, the job of the text and the voice first.",
    "Before writing copy, agree the reader, the job of the text, the voice, the proof available, the limits and what done looks like.",
  ),
  skill(
    "writing",
    "edit-proofread",
    "Edit and proofread",
    "A clean version and a list of the main changes.",
    "When editing, fix structure, clarity, grammar and consistency, return a clean version, and list the main changes.",
  ),
  skill(
    "writing",
    "rewrite-tone",
    "Rewrite for a new reader",
    "Change length, tone or channel while keeping every fact.",
    "When rewriting for a new reader, length, tone or channel, keep every fact and say what changed.",
  ),
  skill(
    "writing",
    "brand-voice",
    "Brand voice",
    "A short guide to how the brand sounds, with examples.",
    "For a brand voice, describe the voice, the tone by situation, words to use and avoid, and sentence rules, with short before and after examples from the person's own copy.",
  ),
  skill(
    "writing",
    "web-page-copy",
    "Web page copy",
    "A landing page written section by section.",
    "For a web page, write section by section: headline, subhead, benefits, proof, answers to objections, a call to action, and a search title and description.",
  ),
  skill(
    "writing",
    "check-claims",
    "Check claims",
    "Find claims that need proof and fix what cannot be backed.",
    "Before copy is used, list every claim that needs proof, such as numbers, 'best', comparisons, testimonials and health or money promises, the evidence each needs, and rewrite what cannot be backed.",
  ),
  skill(
    "writing",
    "academic-help",
    "Help with academic writing",
    "Plan, structure and cite the author's own work.",
    "For academic work, help the author plan, structure, improve and cite their own writing. Do not write graded work for them, and never invent a source or a quote.",
  ),
  skill(
    "writing",
    "song-lyrics",
    "Song lyrics",
    "Original lyrics with structure, meter and syllable counts.",
    "For lyrics, write original words with verse, chorus and bridge, a steady meter and syllable counts that fit the melody. Never copy existing lyrics or imitate a named artist.",
  ),
  skill(
    "writing",
    "fact-check",
    "Fact check",
    "Trace a claim to its source and rate it.",
    "To fact-check, isolate the claim, trace it to the primary source, look for two independent sources, check dates, numbers and exact quotes, then rate it confirmed, partly confirmed, unconfirmed, false or cannot tell.",
  ),
  skill(
    "writing",
    "news-briefing",
    "News briefing",
    "Top stories first, why each matters, and where it is from.",
    "In a news briefing, put the top stories first, say what is new since last time and why each matters, and give the outlet, date and link for every item.",
  ),
  skill(
    "writing",
    "news-article",
    "News article",
    "The news first, then context, with named sources.",
    "In a news article, put the news in the first line, then context, with named attribution. Quote only real interviews or documents, and give anyone accused a chance to reply.",
  ),
  skill(
    "writing",
    "headlines",
    "Headlines",
    "Accurate, specific headlines the story supports.",
    "For headlines, write accurate, specific lines the story supports, with a one-line summary under them. Offer options for the page and for search.",
  ),
  skill(
    "writing",
    "interview-prep",
    "Prepare an interview",
    "Research, goals and open questions before an interview.",
    "To prepare an interview, research the person and topic from sources you can name, set the goal, write open questions with follow-ups, and agree how quotes may be used.",
  ),
  skill(
    "writing",
    "sources-ethics",
    "Sources and ethics",
    "Check fairness, harm and sourcing before a story runs.",
    "Before a story runs, check anonymous sources, fairness, possible harm, conflicts of interest and copyright, and say what needs a correction or a lawyer's look.",
  ),
  skill(
    "writing",
    "set-plan",
    "Plan a set",
    "Order a DJ set by the room, the length and the energy.",
    "For a set, start from the room, the length and the energy wanted. Order it in phases with key and tempo notes for each transition. Name tracks only when the person named them.",
  ),
  skill(
    "writing",
    "track-outline",
    "Outline a track",
    "Sections, bar counts and where the energy moves.",
    "To outline a track, list the sections with bar counts, where the energy rises and drops, and what still needs work.",
  ),
  skill(
    "writing",
    "mix-notes",
    "Mix notes",
    "Levels, low end, transitions and what to fix next.",
    "In mix notes, cover levels, the low end, transitions and what to fix next, one change at a time.",
  ),
  skill(
    "writing",
    "beat-brief",
    "Beat brief",
    "The feel, tempo and what done looks like for a new track.",
    "For a beat brief, describe the feel, the tempo range and reference moods in words, and what done looks like. Never copy an existing track.",
  ),

  // Research and learning
  skill(
    "learning",
    "research-brief",
    "Research brief",
    "What is known, what is assumed and the cheapest next test.",
    "For a research question, restate it, give what is known from checked sources, mark each claim checked, assumed or open, list possible approaches and pick the cheapest test first.",
  ),
  skill(
    "learning",
    "literature-search",
    "Literature search",
    "Find and list papers, with nothing invented.",
    "In a literature search, look in more than one place, follow references both ways, and list each paper with authors, year and where it appeared. Never list a paper you did not find.",
  ),
  skill(
    "learning",
    "paper-notes",
    "Notes on a paper",
    "The question, the claims, the evidence and what is open.",
    "When reading a paper, note the question, the main claims and their evidence, the assumptions, what you could recheck and the open questions.",
  ),
  skill(
    "learning",
    "check-maths",
    "Check maths and proofs",
    "Test small cases and check each step of a derivation.",
    "To check maths, restate the claim with every assumption, test small and edge cases first, look for a counterexample, then check each step. Say which steps you verified and how.",
  ),
  skill(
    "learning",
    "check-numbers",
    "Check a numerical result",
    "Refine, compare and test against known answers.",
    "For a numerical result, refine the grid or step size and compare, check the order of convergence against the method's, and test against conservation laws or known solutions.",
  ),
  skill(
    "learning",
    "reproducible-analysis",
    "Reproducible analysis",
    "Record data sources, versions and steps so results can be rerun.",
    "For an analysis, record where the data came from, fixed random seeds, versions and the exact steps to rerun it, so someone else gets the same numbers.",
  ),
  skill(
    "learning",
    "latex-writing",
    "Write in LaTeX",
    "One clean, self-contained LaTeX file.",
    "For LaTeX, write one self-contained file with a clean preamble, numbered equations, units and tables set properly, and references only from a list the author keeps.",
  ),
  skill(
    "learning",
    "lesson-plan",
    "Lesson plan",
    "Plan a lesson backward from what learners should be able to do.",
    "For a lesson, plan backward from two to four measurable outcomes, with timed parts, an example, practice and a check for understanding at the end.",
  ),
  skill(
    "learning",
    "explain-and-check",
    "Explain and check",
    "One idea, one example, then check understanding.",
    "To explain something, give one idea with one worked example, ask the learner to explain it back, then check with two or three short questions.",
  ),
  skill(
    "learning",
    "hints-first",
    "Hints before answers",
    "Help with a problem without giving the answer away.",
    "When helping with a problem, ask what they tried, then give the smallest hint that helps, one step at a time. Never hand over the full solution to graded work.",
  ),
  skill(
    "learning",
    "quiz-items",
    "Quiz and exam items",
    "Questions from the outcomes, with a key that explains each option.",
    "For quiz items, write from the outcomes, with one best answer, wrong options based on real mistakes, and a key that explains each option.",
  ),
  skill(
    "learning",
    "rubric-feedback",
    "Rubric and feedback",
    "Levels that describe evidence, and feedback that helps next time.",
    "For a rubric, write levels that describe evidence. Feedback says where the work is going, how it is going and what to do next.",
  ),
  skill(
    "learning",
    "find-misconception",
    "Find the misconception",
    "Name the misunderstanding behind a wrong answer.",
    "For a wrong answer, name the likely misunderstanding behind it, show it with a question or a counterexample, and set one follow-up item to check the fix.",
  ),
  skill(
    "learning",
    "problem-set",
    "Problem set",
    "Exercises tied to the outcomes, with checked solutions.",
    "For a problem set, tie exercises to the outcomes, mix in review, write worked solutions you have checked, and keep the marking scheme separate.",
  ),

  // Design and making
  skill(
    "design",
    "design-brief",
    "Design brief",
    "Goals, audience, limits and deliverables before designing.",
    "Before designing, agree the goals, the audience, the constraints, the deliverables and the first review step.",
  ),
  skill(
    "design",
    "design-review",
    "Design review",
    "Check usability, accessibility and consistency, ranked.",
    "In a design review, check usability, accessibility (contrast, focus, labels, target size), consistency and readiness to build. Rank findings by severity and never claim a check you did not run.",
  ),
  skill(
    "design",
    "design-system",
    "Design system",
    "Tokens, contrast and every component state.",
    "For a design system, define tokens for colour, type, spacing and radius, colour pairs with their contrast ratio, and each component with all its states.",
  ),
  skill(
    "design",
    "user-flows",
    "User flows",
    "Who the users are and the steps of each key path.",
    "For user flows, name the user groups from the research given, their key journeys, and the screens and steps of each path, before any wireframe.",
  ),
  skill(
    "design",
    "wireframes",
    "Wireframes",
    "Simple screens for each step, with real labels.",
    "For wireframes, start simple, one screen per step of the flow, with real labels and content instead of filler text.",
  ),
  skill(
    "design",
    "brand-identity",
    "Brand identity",
    "Positioning, logo directions, colour and type.",
    "For a brand identity, start with positioning, then a few logo directions described clearly, a colour palette, type choices and short usage rules.",
  ),
  skill(
    "design",
    "build-handoff",
    "Handoff to build",
    "Specs a developer can build from without guessing.",
    "For a handoff, give specs, tokens, spacing, every state, assets and acceptance notes, so a developer can build it without guessing.",
  ),
  skill(
    "design",
    "check-measurements",
    "Check measurements",
    "Make sure room measurements add up before drawing.",
    "Before drawing a space, check every room has its dimensions, openings and heights in one unit, and that the lengths add up. List conflicts instead of picking a number.",
  ),
  skill(
    "design",
    "room-layout",
    "Room layout",
    "Compare furniture layouts with clearances and paths.",
    "For a room layout, compare two or three arrangements inside the measured room, with clearances, walking paths, storage and access needs.",
  ),
  skill(
    "design",
    "materials-finishes",
    "Materials and finishes",
    "A schedule of each surface's material and finish.",
    "For materials and finishes, list each surface's material, finish, colour and quantity, with a reason for each choice.",
  ),
  skill(
    "design",
    "lighting-plan",
    "Lighting plan",
    "Ambient, task and accent light for each room.",
    "For a lighting plan, give ambient, task and accent light per room, with fixture types, switching zones and daylight noted.",
  ),
  skill(
    "design",
    "engineering-requirements",
    "Engineering requirements",
    "Measurable requirements and a first prototype plan.",
    "Turn a product idea into measurable requirements, interfaces, limits and a first prototype plan, each with how it will be checked.",
  ),
  skill(
    "design",
    "check-calculations",
    "Check calculations",
    "Units, assumptions and a second way to the result.",
    "For an engineering calculation, write every quantity with units, state the load cases and assumptions, check the result a second way, and give the uncertainty.",
  ),
  skill(
    "design",
    "compare-concepts",
    "Compare concepts",
    "Score options against requirements and evidence.",
    "To compare concepts, score each against the measurable requirements, manufacturing limits and evidence, and say what the scores depend on.",
  ),
  skill(
    "design",
    "design-for-making",
    "Design for making",
    "Review material, process and assembly choices.",
    "To review a design for making, check material, process and assembly choices against the maker's stated capabilities. Prefer fewer parts, fewer fasteners and a clear assembly order.",
  ),
  skill(
    "design",
    "parts-list",
    "Parts list",
    "Each part with quantity, material, source and revision.",
    "For a parts list, give each part with quantity, material, make or buy, source and revision. Mark cost and availability as assumptions unless they were given.",
  ),
  skill(
    "design",
    "drawings-tolerances",
    "Drawings and tolerances",
    "Dimension what matters and tie tolerances to inspection.",
    "On drawings, dimension what matters for fit and function, set tolerances only where needed, and tie each tolerance to how it will be inspected.",
  ),
  skill(
    "design",
    "prototype-tests",
    "Prototype tests",
    "Set the test and pass mark before testing.",
    "For a prototype test, write the test, the pass mark and the measurement before testing, and report results against them. Never call something proven without measured evidence.",
  ),

  // Everyday
  skill(
    "everyday",
    "daily-brief",
    "Daily brief",
    "Today's meetings, replies due and the one key step.",
    "In a daily brief, list today's meetings, messages that need a reply, follow-ups that are due, and the one step that moves a goal forward today.",
  ),
  skill(
    "everyday",
    "inbox-triage",
    "Sort an inbox",
    "Reply now, hand off, read later or archive.",
    "To sort an inbox, put each message in reply now, hand off, read later or archive, with a one-line reason and a next step. Flag anything that looks like a scam or asks to change payment details.",
  ),
  skill(
    "everyday",
    "meeting-prep",
    "Prepare a meeting",
    "Who is coming, why it matters and the decision to get.",
    "To prepare a meeting, say who is coming, why it matters, what was said last time, the open items and the decision to get.",
  ),
  skill(
    "everyday",
    "meeting-notes",
    "Meeting notes",
    "A recap, decisions and action items with owners.",
    "From notes or a transcript, write a short recap, the decisions, and action items each with an owner and a date. Mark anything unclear instead of guessing.",
  ),
  skill(
    "everyday",
    "weekly-review",
    "Weekly review",
    "Progress on goals, what slipped and next week's steps.",
    "In a weekly review, give progress against each goal, what got done, what slipped, open follow-ups and next week's top steps.",
  ),
  skill(
    "everyday",
    "strategy-note",
    "Strategy note",
    "A few options, their trade-offs and one recommendation.",
    "In a strategy note, state the goal, a few options with the trade-off of each, and one recommendation with what would change it.",
  ),
  skill(
    "everyday",
    "hand-off",
    "Hand off work",
    "A clear brief when asking another assistant.",
    "When you ask another assistant, give the goal, the context it needs, the deadline and what done looks like, in one message.",
  ),
  skill(
    "everyday",
    "meeting-time",
    "Find a meeting time",
    "Three options in every attendee's time zone.",
    "To find a meeting time, propose three options, each shown in every attendee's time zone, and flag clashes and travel.",
  ),
  skill(
    "everyday",
    "travel-checklist",
    "Travel checklist",
    "Documents, bookings, a day-by-day plan and hand-offs.",
    "For a trip, list documents, bookings still to make, a day-by-day plan, time zone changes and what to hand off while away. The person books and pays.",
  ),
];
