import { CODE_ALPHABET } from "./codes";

/**
 * The words the pet says for each assistant role, keyed by canonical persona
 * id (an alias such as `coder` resolves through `ROLE_ALIASES`). The
 * order is the order of the role clips in a voice pack and of
 * `PET_ROLE_IDS[]` in the firmware's header.
 */
export const PET_ROLE_NAMES = {
  developer: "Coder",
  accountant: "Accountant",
  marketing: "Marketing assistant",
  legal: "Legal assistant",
  "product-owner": "Product owner",
  sales: "Sales assistant",
  "executive-assistant": "Executive assistant",
  support: "Support assistant",
  recruiting: "Recruiting assistant",
  eshop: "eShop assistant",
  dj: "DJ",
  copywriter: "Copywriter",
  teacher: "Professor's assistant",
  scientist: "Scientist",
  architect: "Architect",
  "mechanical-engineer": "Mechanical Engineer",
  designer: "Designer",
  journalist: "Journalist",
  agriculture: "Agronomist",
} as const;

export type PetRoleId = keyof typeof PET_ROLE_NAMES;

/** The canonical persona ids that have a role clip, in clip order. */
export const PET_ROLE_IDS = Object.keys(PET_ROLE_NAMES) as PetRoleId[];

/**
 * Other names for a role: the persona ids of this app's `personas` folder and
 * the older names the protocol has always accepted. Each one resolves to the id
 * of a clip in `PET_ROLE_NAMES`.
 */
const ROLE_ALIASES: Readonly<Record<string, PetRoleId>> = {
  coder: "developer",
  financial: "accountant",
  lawyer: "legal",
  ea: "executive-assistant",
  "customer-support": "support",
  recruiter: "recruiting",
  store: "eshop",
  "online-shop": "eshop",
  "musician-dj": "dj",
  "music-producer": "dj",
  copy: "copywriter",
  writer: "copywriter",
  "content-writer": "copywriter",
  "professors-assistant": "teacher",
  "professor-assistant": "teacher",
  tutor: "teacher",
  lecturer: "teacher",
  instructor: "teacher",
  researcher: "scientist",
  "research-scientist": "scientist",
  "building-architect": "architect",
  "interior-designer": "architect",
  mechanical: "mechanical-engineer",
  "mechanical-design-engineer": "mechanical-engineer",
  "ui-designer": "designer",
  "ux-designer": "designer",
  "product-designer": "designer",
  "brand-designer": "designer",
  "graphic-designer": "designer",
  "industrial-designer": "designer",
  "visual-designer": "designer",
  reporter: "journalist",
  "news-reporter": "journalist",
  "news-writer": "journalist",
  "news-editor": "journalist",
  "fact-checker": "journalist",
  agronomist: "agriculture",
  "farm-advisor": "agriculture",
  "farm-manager": "agriculture",
  "crop-advisor": "agriculture",
  farmer: "agriculture",
};

/** What a role the pet has no clip for is called. */
export const PET_GENERIC_ROLE_ID = "assistant";

const GENERIC_ROLE_NAME = "assistant";

type Chars<S extends string> = S extends `${infer Head}${infer Tail}`
  ? Head | Chars<Tail>
  : never;

type CodeChar = Chars<typeof CODE_ALPHABET>;

const FIXED_LINE_IDS = [
  "setup-join",
  "setup-code",
  "setup-code-again",
  "setup-wifi-failed",
  "setup-refused",
  "setup-done",
  "hello",
  "saved",
  "memory-full",
  "back-online",
  "sent",
  "working",
  "done",
  "needs-approve",
  "stopped",
  "refused",
  "budget",
  "message",
  "out-of-credits",
  "spending-limit",
  "no-access",
  "battery-low",
  "charging",
  "mic-off",
  "busy",
  "didnt-catch",
  "paused",
  "disconnected",
  "notice-done",
  "notice-approval",
  "notice-stopped",
] as const;

/** The id of a clip in the voice pack: `done`, `char-K`, `role-developer`. */
export type PetLineId =
  | (typeof FIXED_LINE_IDS)[number]
  | `char-${CodeChar}`
  | `role-${PetRoleId | typeof PET_GENERIC_ROLE_ID}`;

export interface PetLine {
  readonly id: PetLineId;
  /** What the voice says. Never the pet's name, a step, an amount or a digit. */
  readonly text: string;
  /** Also compiled into the firmware image, so the pet can speak it unpaired. */
  readonly boot: boolean;
}

const DIGIT_WORDS: Readonly<Record<string, string>> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

/** A character of a code as a word: letters as themselves, digits spelled out. */
export function charWord(char: string): string {
  const digit = DIGIT_WORDS[char];
  if (digit !== undefined) {
    return digit;
  }
  if (/^[A-Za-z]$/.test(char)) {
    return char.toUpperCase();
  }
  throw new RangeError("Only a letter or a digit has a spoken word.");
}

const FIXED_LINES: Readonly<Record<(typeof FIXED_LINE_IDS)[number], string>> = {
  "setup-join":
    "Hi! To set me up, plug me into your computer and open OpenStellarFirm, or join my Wi-Fi network on your phone.",
  "setup-code":
    "Here is my confirm code. I will say it three times, slowly. Type it in OpenStellarFirm.",
  "setup-code-again": "Listen, here is the code again.",
  "setup-wifi-failed": "I couldn't join that Wi-Fi. Please try again.",
  "setup-refused": "OpenStellarFirm didn't accept that. Let's set me up again.",
  "setup-done": "All set. Hold my lime light and talk to me.",
  hello: "Hi! Hold my lime light and talk to me.",
  saved: "I'm offline, so I saved that. I'll send it when we're back online.",
  "memory-full":
    "My memory is full. I'll send your saved notes when we're back online.",
  "back-online": "I'm back online.",
  sent: "Sent your saved notes.",
  working: "Your team is on it. I'll tell you when it's ready.",
  done: "Your work is ready. Open OpenStellarFirm to see it.",
  "needs-approve":
    "One of your assistants is waiting for your Approve. Open OpenStellarFirm to decide.",
  stopped:
    "Your team stopped before the work was finished. Open OpenStellarFirm to see why.",
  refused: "Your rules stop that one. Open OpenStellarFirm to see why.",
  budget: "Your team reached a spending alert. Open OpenStellarFirm to see it.",
  message: "Your team has a message for you. Open OpenStellarFirm to read it.",
  "out-of-credits":
    "Your voice quota is used up. Check your speech plan, then try again.",
  "spending-limit":
    "Your spending limit stops me here. Open OpenStellarFirm to change it.",
  "no-access": "My voice key was refused. Open OpenStellarFirm to check it.",
  "battery-low": "My battery is low. Please plug me in.",
  charging: "Charging.",
  "mic-off": "My microphone is switched off.",
  busy: "OpenStellarFirm is busy right now. Please try again in a moment.",
  "didnt-catch": "Sorry, I didn't catch that.",
  paused: "I'm paused. Turn me back on in OpenStellarFirm.",
  disconnected:
    "I'm not connected to OpenStellarFirm anymore. Set me up again in OpenStellarFirm.",
  "notice-done": "finished. Open OpenStellarFirm to see it.",
  "notice-approval":
    "is waiting for your Approve. Open OpenStellarFirm to decide.",
  "notice-stopped":
    "stopped before it finished. Open OpenStellarFirm to see why.",
};

/** The lines the firmware image carries, so an unpaired pet can still speak. */
const BOOT_LINE_IDS: ReadonlySet<string> = new Set([
  "setup-join",
  "setup-code",
  "setup-code-again",
  "setup-wifi-failed",
  "setup-refused",
  "setup-done",
  "saved",
  "memory-full",
  "battery-low",
  "charging",
  "mic-off",
  "busy",
  "didnt-catch",
  "disconnected",
]);

function buildLines(): readonly PetLine[] {
  const lines: PetLine[] = [];
  const add = (id: PetLineId, text: string, boot: boolean): void => {
    lines.push({ id, text, boot });
  };
  const fixed = (id: (typeof FIXED_LINE_IDS)[number]): void => {
    add(id, FIXED_LINES[id], BOOT_LINE_IDS.has(id));
  };
  // The table's order: setup, the confirm code's characters, then the rest,
  // with the role clips last.
  for (const id of FIXED_LINE_IDS.slice(0, 6)) {
    fixed(id);
  }
  for (const char of CODE_ALPHABET) {
    add(`char-${char}` as PetLineId, charWord(char), true);
  }
  for (const id of FIXED_LINE_IDS.slice(6)) {
    fixed(id);
  }
  for (const role of PET_ROLE_IDS) {
    add(`role-${role}`, `Your ${PET_ROLE_NAMES[role]}`, false);
  }
  add(`role-${PET_GENERIC_ROLE_ID}`, `Your ${GENERIC_ROLE_NAME}`, false);
  return lines;
}

/** Every clip of a voice pack, in pack order. */
export const PET_LINES: readonly PetLine[] = buildLines();

const LINES_BY_ID: ReadonlyMap<string, PetLine> = new Map(
  PET_LINES.map((line) => [line.id, line]),
);

export function isPetLineId(value: unknown): value is PetLineId {
  return typeof value === "string" && LINES_BY_ID.has(value);
}

/** The line for an id. An id that is not in the pack throws. */
export function petLine(id: PetLineId): PetLine {
  const line = LINES_BY_ID.get(id);
  if (!line) {
    throw new RangeError(`There is no pet line "${id}".`);
  }
  return line;
}

/**
 * The canonical role id the pet has a clip for. A missing role is `undefined`;
 * a role the pet has no clip for (a persona added later) is `assistant`.
 */
export function petRoleId(
  role: string | undefined | null,
): PetRoleId | typeof PET_GENERIC_ROLE_ID | undefined {
  const raw = role?.trim();
  if (!raw) {
    return undefined;
  }
  // hasOwn, not `in`: "constructor" is on every object but is not a role.
  if (Object.hasOwn(PET_ROLE_NAMES, raw)) {
    return raw as PetRoleId;
  }
  return (
    (Object.hasOwn(ROLE_ALIASES, raw) ? ROLE_ALIASES[raw] : undefined) ??
    PET_GENERIC_ROLE_ID
  );
}

/**
 * The hello a pet gets in its inbox when it is set up and has a name: the
 * server pushes it as a `message` notice that the pet fetches spoken. A pet's
 * name is letters only (`PetNameSchema`), so the sentence carries no digit.
 * Kept here, beside `PET_LINES`, so a renamed product is one place for every
 * word a pet says.
 */
export function petHelloLine(name: string): string {
  return `Hi, I'm ${name}. Hold my lime light and talk to me.`;
}

/**
 * What a `done` notice says when it names the work: the cleaned title
 * (`spokenTitle`) in the pack's own sentence for a finished piece of work.
 */
export function petDoneTitleLine(title: string): string {
  return `Your ${title} is ready. Open OpenStellarFirm to see it.`;
}

/** "Coder", "Marketing assistant"; "assistant" for a role the pet does not know. */
export function spokenRoleName(role?: string | null): string {
  const id = petRoleId(role);
  return id === undefined || id === PET_GENERIC_ROLE_ID
    ? GENERIC_ROLE_NAME
    : PET_ROLE_NAMES[id];
}
