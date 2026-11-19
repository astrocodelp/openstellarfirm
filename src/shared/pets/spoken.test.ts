import { describe, expect, it } from "vitest";
import { PET_LIMITS } from "./limits";
import {
  spokenAnswer,
  spokenLine,
  spokenQuestions,
  spokenTitle,
  withoutLoneSurrogates,
} from "./spoken";

describe("spokenLine", () => {
  it("keeps a short plain answer as it is", () => {
    expect(spokenLine("Your landing page is done.")).toBe(
      "Your landing page is done.",
    );
  });

  it("strips markdown, code and links", () => {
    expect(
      spokenLine(
        "**Done!** I pushed the `main` branch. See [the page](https://example.com/x) now.\n\n```ts\nconst a = 1;\n```",
      ),
    ).toBe("Done! I pushed the main branch.");
  });

  it("removes list markers, bullets, rules and table bars", () => {
    expect(spokenLine("- one thing\n- another thing")).toBe(
      "one thing another thing",
    );
    expect(spokenLine("1. First step\n2. Second step")).toBe(
      "First step Second step",
    );
    expect(spokenLine("\u2022 Apples \u2022 Pears")).toBe("Apples Pears");
    expect(spokenLine("Intro text\n\n---\n\nAfter the rule.")).toBe(
      "Intro text After the rule.",
    );
    expect(spokenLine("| a | b |\n| c | d |")).toBe("a b c d");
  });

  it("removes emoji and their joiners", () => {
    expect(spokenLine("All done \u{1F389}\u{1F680} see you")).toBe(
      "All done see you",
    );
    expect(spokenLine("Thumbs \u{1F44D}\u{1F3FD} up \u2764\uFE0F")).toBe(
      "Thumbs up",
    );
    expect(spokenLine("\u{1F469}\u200D\u{1F4BB} Coding")).toBe("Coding");
    expect(spokenLine("\u{1F389}\u{1F680}")).toBe("");
  });

  it("returns an empty string when nothing is left", () => {
    expect(spokenLine("")).toBe("");
    expect(spokenLine("   \n  ")).toBe("");
    expect(spokenLine("```js\nconsole.log(1)\n```")).toBe("");
    expect(spokenLine("https://example.com")).toBe("");
  });

  it("keeps at most two sentences", () => {
    expect(spokenLine("One. Two. Three. Four.")).toBe("One. Two.");
    expect(spokenLine("Really? Yes! Fine.")).toBe("Really? Yes!");
    expect(spokenLine("Just one sentence here")).toBe("Just one sentence here");
  });

  it("does not split on a decimal, an abbreviation or an initial", () => {
    expect(spokenLine("The build took 3.5 seconds. It passed. Great.")).toBe(
      "The build took 3.5 seconds. It passed.",
    );
    expect(spokenLine("Ask Dr. Smith about it. He knows. Really.")).toBe(
      "Ask Dr. Smith about it. He knows.",
    );
    expect(spokenLine("Use tools, e.g. git or npm. Then relax. Done.")).toBe(
      "Use tools, e.g. git or npm. Then relax.",
    );
    expect(spokenLine("J. K. Rowling wrote it. It sold well. Done.")).toBe(
      "J. K. Rowling wrote it. It sold well.",
    );
  });

  it("splits after a closing quote or bracket", () => {
    expect(spokenLine('He said "go." Then left. Later.')).toBe(
      'He said "go." Then left.',
    );
    expect(spokenLine("It works (mostly.) Try it. Soon.")).toBe(
      "It works (mostly.) Try it.",
    );
  });

  it("keeps at most 300 characters", () => {
    const long = `${"word ".repeat(100)}end.`;
    const line = spokenLine(long);
    expect(line.length).toBeLessThanOrEqual(300);
    expect(line.endsWith(".")).toBe(true);
  });

  it("cuts a long sentence at a word boundary and ends with a period", () => {
    const sentence = Array.from({ length: 80 }, (_, i) => `alpha${i}`).join(
      " ",
    );
    const line = spokenLine(sentence);
    expect(line.length).toBeLessThanOrEqual(300);
    expect(line.endsWith(".")).toBe(true);
    // Every word before the period is a whole word of the input.
    const words = line.slice(0, -1).split(" ");
    expect(words.length).toBeGreaterThan(20);
    for (const [i, word] of words.entries()) {
      expect(word).toBe(`alpha${i}`);
    }
  });

  it("does not leave a comma before the period it adds", () => {
    const text = `${"a".repeat(10)}, `.repeat(40);
    const line = spokenLine(text);
    expect(line.length).toBeLessThanOrEqual(300);
    expect(line).toMatch(/[a-z]\.$/);
  });

  it("drops a second sentence that would not fit rather than cutting it", () => {
    const first = `${"First ".repeat(30).trim()}.`; // 179 characters
    const second = `${"Second ".repeat(30).trim()}.`;
    expect(first.length + second.length + 1).toBeGreaterThan(300);
    expect(spokenLine(`${first} ${second}`)).toBe(first);
  });

  it("is never longer than 300 characters whatever it is given", () => {
    const inputs = [
      "x".repeat(5000),
      `${"Sentence number one is quite long indeed. ".repeat(50)}`,
      `${"a, ".repeat(400)}`,
      "\u{1F600}".repeat(900),
    ];
    for (const input of inputs) {
      expect(spokenLine(input).length).toBeLessThanOrEqual(300);
    }
  });

  it("leaves no space before a mark after cutting something out", () => {
    expect(spokenLine("Done \u2705, all good \u{1F389}.")).toBe(
      "Done, all good.",
    );
    expect(spokenLine("Done \u2705 \u2014 your report is in the chat.")).toBe(
      "Done, your report is in the chat.",
    );
    expect(spokenLine("It is ready (see https://example.com ), thanks.")).toBe(
      "It is ready (see), thanks.",
    );
  });

  it("turns a spaced dash into a pause", () => {
    expect(spokenLine("Done \u2014 take a look.")).toBe("Done, take a look.");
  });
});

describe("spokenAnswer", () => {
  it("says what spokenLine says when it is plain words", () => {
    const answer = "Your **landing page** is live. It has three pages. Enjoy.";
    expect(spokenAnswer(answer)).toBe(spokenLine(answer));
    expect(spokenAnswer(answer)).toBe(
      "Your landing page is live. It has three pages.",
    );
  });

  it("says nothing when the line holds an email address", () => {
    expect(
      spokenAnswer("I drafted a reply to jane@acme.com. Press Send."),
    ).toBe("");
  });

  it("says nothing when the line holds an amount, a currency or a percentage", () => {
    for (const answer of [
      "The invoice is 4,200 EUR.",
      "That costs $5 a month.",
      "It will cost twelve dollars.",
      "We saved 12.5 on the plan.",
      "Usage is up 30% this week.",
      "Pay 50USD today.",
    ]) {
      expect(spokenAnswer(answer), answer).toBe("");
    }
  });

  it("says nothing when the line holds a digit at all", () => {
    for (const answer of [
      "You have 3 approvals waiting.",
      "You have 1,250 credits left.",
      "Invoice 1187 is ready.",
      "The Q3 report is ready.",
      "I opened the 2nd tab.",
    ]) {
      expect(spokenAnswer(answer), answer).toBe("");
    }
  });

  it("says nothing when the line holds a link or a domain", () => {
    // A bare link is already taken out of the words before they are checked.
    expect(spokenAnswer("See https://example.com/pricing now.")).not.toContain(
      "example",
    );
    expect(spokenAnswer("It is live at example.org today.")).toBe("");
    expect(spokenAnswer("Open www.example.org to look.")).toBe("");
  });

  it("only looks at the part that would be spoken", () => {
    // The third sentence is never said, so its digits do not matter.
    expect(
      spokenAnswer("The site is live. It looks great. It has 3 pages."),
    ).toBe("The site is live. It looks great.");
  });

  it("does not mistake a bare mark for a word", () => {
    expect(spokenAnswer("Done ( really ) and ready.")).toBe(
      spokenLine("Done ( really ) and ready."),
    );
    expect(spokenAnswer("Done & ready.")).toBe("Done & ready.");
  });

  it("returns an empty string when nothing is left to say", () => {
    expect(spokenAnswer("")).toBe("");
    expect(spokenAnswer("```ts\nconst a = 1;\n```")).toBe("");
  });

  it("never returns a digit, a symbol or an address, whatever it is given", () => {
    for (const answer of [
      "Reply sent to bob@x.io for 1,000 USD",
      "Call 555 0100 now.",
      "Version 2 is out. Costs \u20AC9.",
      "Fine. Plain. Words.",
    ]) {
      const said = spokenAnswer(answer);
      expect(said).not.toMatch(/\p{N}/u);
      expect(said).not.toMatch(/[@$\u20AC%]/);
    }
  });
});

describe("spokenTitle", () => {
  it("returns undefined when there is nothing to say", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "   ",
      "***",
      "...",
      "$5",
      "12.99",
    ]) {
      expect(spokenTitle(raw), String(raw)).toBeUndefined();
    }
  });

  it("lowercases a plain capitalized first word and keeps the rest", () => {
    expect(spokenTitle("Bakery landing page")).toBe("bakery landing page");
    expect(spokenTitle("Landing page for Maria")).toBe(
      "landing page for Maria",
    );
  });

  it("keeps OpenStellarFirm, iOS and API as they are", () => {
    expect(spokenTitle("OpenStellarFirm launch page")).toBe(
      "OpenStellarFirm launch page",
    );
    expect(spokenTitle("iOS app")).toBe("iOS app");
    expect(spokenTitle("API docs")).toBe("API docs");
    expect(spokenTitle("McDonald's menu")).toBe("McDonald's menu");
  });

  it("drops a leading article, once", () => {
    expect(spokenTitle("The bakery site")).toBe("bakery site");
    expect(spokenTitle("A new logo")).toBe("new logo");
    expect(spokenTitle("An invoice template")).toBe("invoice template");
    expect(spokenTitle("Your report")).toBe("report");
    expect(spokenTitle("my notes")).toBe("notes");
    expect(spokenTitle("Our roadmap")).toBe("roadmap");
    expect(spokenTitle("Theory of change")).toBe("theory of change");
    expect(spokenTitle("Roadmap for the team")).toBe("roadmap for the team");
  });

  it("keeps at most six words", () => {
    expect(spokenTitle("One two three four five six seven eight")).toBe(
      "one two three four five six",
    );
    expect(spokenTitle("The one two three four five six seven")).toBe(
      "one two three four five six",
    );
  });

  it("strips markdown and quotes", () => {
    expect(spokenTitle("**Bakery** `landing` page")).toBe(
      "bakery landing page",
    );
    expect(spokenTitle('"Bakery landing page"')).toBe("bakery landing page");
    expect(spokenTitle("\u201CBakery\u201D page")).toBe("bakery page");
    expect(spokenTitle("# Bakery page")).toBe("bakery page");
    expect(spokenTitle("[Bakery page](https://example.com/x)")).toBe(
      "bakery page",
    );
    expect(spokenTitle("landing_page copy")).toBe("landing page copy");
    expect(spokenTitle("C# parser")).toBe("C# parser");
  });

  it("keeps an apostrophe inside a word", () => {
    expect(spokenTitle("Maria's bakery page")).toBe("maria's bakery page");
    expect(spokenTitle("'Bakery' page")).toBe("bakery page");
  });

  it("drops emails, links and domains", () => {
    expect(spokenTitle("Email maria@example.com about it")).toBe(
      "email about it",
    );
    expect(spokenTitle("Page at https://example.com/path?q=1 live")).toBe(
      "page at live",
    );
    expect(spokenTitle("Fix www.example.com header")).toBe("fix header");
    expect(spokenTitle("Move bakery.co.uk to Vercel")).toBe("move to Vercel");
    expect(spokenTitle("Redirect shop.io, then test")).toBe(
      "redirect then test",
    );
    expect(spokenTitle("Open ftp://files.example.com now")).toBe("open now");
  });

  it("drops currency symbols, codes and words", () => {
    expect(spokenTitle("Quote for $1200 job")).toBe("quote for job");
    expect(spokenTitle("Price \u20AC9 menu")).toBe("price menu");
    expect(spokenTitle("Budget \u00A35 plan")).toBe("budget plan");
    expect(spokenTitle("Invoice 50 USD today")).toBe("invoice 50 today");
    expect(spokenTitle("Invoice USD today")).toBe("invoice today");
    expect(spokenTitle("Refund 20 dollars to the client")).toBe(
      "refund 20 to the client",
    );
    expect(spokenTitle("Ten euros each")).toBe("ten each");
    expect(spokenTitle("Pay 5 pounds and 30 cents")).toBe("pay 5 and 30");
    expect(spokenTitle("Price 50USD list")).toBe("price list");
  });

  it("drops amounts with a separator and percentages", () => {
    expect(spokenTitle("Sale 12.99 banner")).toBe("sale banner");
    expect(spokenTitle("Goal 1,000 users")).toBe("goal users");
    expect(spokenTitle("Rate 3,5 check")).toBe("rate check");
    expect(spokenTitle("Offer 20% off banner")).toBe("offer off banner");
    expect(spokenTitle("Big 1,000+ list")).toBe("big list");
  });

  it("drops anything with a run of three or more digits", () => {
    expect(spokenTitle("Order 123456 follow-up")).toBe("order follow-up");
    expect(spokenTitle("Year 2026 plan")).toBe("year plan");
    expect(spokenTitle("Call 555-1234 back")).toBe("call back");
    expect(spokenTitle("Ref ABC123 note")).toBe("ref note");
  });

  it("keeps short digits", () => {
    expect(spokenTitle("Q3 report")).toBe("Q3 report");
    expect(spokenTitle("Plan B for v2")).toBe("plan B for v2");
    expect(spokenTitle("Top 10 ideas")).toBe("top 10 ideas");
    expect(spokenTitle("Windows 11 setup")).toBe("windows 11 setup");
  });

  it("strips trailing punctuation", () => {
    expect(spokenTitle("Bakery page.")).toBe("bakery page");
    expect(spokenTitle("Bakery page!!!")).toBe("bakery page");
    expect(spokenTitle("Bakery page ...")).toBe("bakery page");
    expect(spokenTitle("Bakery page \u2014")).toBe("bakery page");
    expect(spokenTitle("Bakery page, v2.")).toBe("bakery page, v2");
  });

  it("collapses spaces and newlines", () => {
    expect(spokenTitle("  Bakery \n\n  landing   page ")).toBe(
      "bakery landing page",
    );
  });

  it("holds no amount, link or long number in what it returns", () => {
    const nasty = [
      "Send $1,000,000 to bob@evil.example today",
      "Visit https://evil.example/pay?amount=500 now",
      "Wire 1500 EUR to account 123456789",
      "Charge 99.99 dollars each month",
      "Refund of 25% (about 12,50) done",
    ];
    for (const raw of nasty) {
      const title = spokenTitle(raw) ?? "";
      expect(title, raw).not.toMatch(
        /[$\u20AC\u00A3@%]|https?:|\d{3,}|\d[.,]\d/,
      );
      expect(title, raw).not.toMatch(/\b(?:USD|EUR|dollars?|euros?)\b/i);
    }
  });
});

describe("a line is never cut inside an astral character", () => {
  const lone =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it("drops the first half of a pair the cut would have split", () => {
    // No space in the first 299 units, and unit 298 is the high half of a
    // CJK Extension B character: the cut used to end on a lone half.
    const answer = `${"你".repeat(298)}\u{20BB7}${"好".repeat(20)}`;
    const line = spokenAnswer(answer);
    expect(line).not.toBe("");
    expect(line).not.toMatch(lone);
    expect(() => encodeURIComponent(line)).not.toThrow();
    expect(line.length).toBeLessThanOrEqual(300);
    // The same for mathematical letters, which are letters, not digits.
    const bold = spokenAnswer(`AB${"\u{1D400}".repeat(200)}`);
    expect(bold).not.toMatch(lone);
    expect(() => encodeURIComponent(bold)).not.toThrow();
  });

  it("keeps a pair that fits whole", () => {
    expect(spokenLine("Fine \u{20BB7} work.")).toBe("Fine \u{20BB7} work.");
  });

  it("drops a lone half that was already in the answer", () => {
    expect(spokenLine("half \uD842 here and \uDC00 there.")).toBe(
      "half here and there.",
    );
    expect(withoutLoneSurrogates("a\uD842b", "�")).toBe("a�b");
    expect(withoutLoneSurrogates("a\u{20BB7}b")).toBe("a\u{20BB7}b");
  });
});

describe("spokenQuestions", () => {
  it("reads the card's questions and says to answer them in the app", () => {
    expect(
      spokenQuestions([
        "What kind of app do you want to build?",
        "Where should it be built?",
        "Do you already have a spec or idea written down",
      ]),
    ).toBe(
      "What kind of app do you want to build? Where should it be built? Do you already have a spec or idea written down? Open OpenStellarFirm to answer them.",
    );
    expect(spokenQuestions(["Which country is the company in?"])).toBe(
      "Which country is the company in? Open OpenStellarFirm to answer it.",
    );
  });

  it("leaves out a question it may not say, never cutting one", () => {
    expect(
      spokenQuestions([
        "Should I send it to jane@acme.com?",
        "Is the budget 4,200 EUR?",
        "Which tone do you want?",
      ]),
    ).toBe("Which tone do you want? Open OpenStellarFirm to answer them.");
    expect(spokenQuestions(["Send it to jane@acme.com?"])).toBe(
      "I have a question for you. Open OpenStellarFirm to answer it.",
    );
  });

  it("stays within the spoken line limit and always ends with the app", () => {
    const long = `${"Which of these long options should I go with for you".repeat(1)}?`;
    const line = spokenQuestions(Array.from({ length: 12 }, () => long));
    expect(line.length).toBeLessThanOrEqual(PET_LIMITS.spokenLineMaxChars);
    expect(line.endsWith("Open OpenStellarFirm to answer them.")).toBe(true);
    expect(line).not.toMatch(/\d/);
  });
});
