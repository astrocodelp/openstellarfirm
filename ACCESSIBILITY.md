# Accessibility

OpenStellarFirm should work for everyone: with a keyboard, a screen reader,
large text, more contrast or less motion. Our target is the Web Content
Accessibility Guidelines (WCAG) 2.2, level AA. That is a goal we work toward,
not a claim: nobody has audited the app against it.

## What the app does

**Settings, Accessibility** holds these choices. They are saved on this
computer only, with the rest of your settings.

- **Contrast.** Follow this computer, more contrast, or standard. More contrast
  makes text, edges, lines and the success and error words stronger, in light
  and dark.
- **Motion.** Follow this computer, less motion, or full motion. Less motion
  keeps short fades and stops everything that moves or breathes, whatever the
  computer is set to.
- **Underline links.** Every link, and every button that opens a page in your
  browser, is underlined.
- **A stronger focus ring.** A thicker ring, further from the control you
  reach with the keyboard.
- **More space for reading.** More space between lines, letters and words.
- **Larger click targets.** Bigger buttons, rows and boxes.
- **Read aloud.** Each answer has a Read aloud button, with a speed you choose.
  It uses only a voice that runs on this computer, so no text leaves it. When
  the computer has no such voice, the button says read aloud is not available
  here.

Text size is in Settings, General, Appearance.

And, always on:

- **Skip links.** The first Tab shows "Skip to the message box" and "Skip to
  the main content", past the sidebar.
- **Landmarks and headings.** The sidebar, Settings' list of pages and the
  main area are named landmarks. Each screen has one top heading, then sections in
  order.
- **One announcer.** A screen reader hears when an answer is finished, when a
  step waits for your Approve, and when something went wrong. An answer is not
  read word by word while it is written. What an assistant is doing right now
  ("Thinking…", "Reading notes.md…") is a status line.
- **Keyboard.** Every control can be reached with Tab and shows a focus ring.
  Ctrl+/ (Cmd+/ on a Mac) lists the app's shortcuts. Ctrl+comma (Cmd+comma)
  opens Settings with the focus on the page's heading; its pages are plain
  buttons in order, the open one marked as the current page, and Escape goes
  back to the chats (not from a text field). A question asked in
  place, such as "Remove this?", takes the focus, closes with Escape, and gives
  the focus back. The shortcuts list is a modal dialog that keeps the focus
  inside until you close it.
- **Names and errors.** Every button that shows only an icon has a name. A
  field's hint and error are tied to the field, so a screen reader reads them
  with it. Status is never shown by colour alone: there is always a word or an
  icon.
- **Contrast checked in code.** A test works out every text and edge colour on
  every surface, in each theme and in more contrast, and fails below 4.5:1 for
  text and 3:1 for edges and the focus ring (7:1 and 4.5:1 with more contrast).

## Tell us about a barrier

If something in the app is hard or impossible for you to use, please open an
issue on GitHub:
[github.com/astrocodelp/openstellarfirm/issues](https://github.com/astrocodelp/openstellarfirm/issues).

It helps to say what you were trying to do, what got in the way, your
operating system, and any assistive technology you use (a screen reader, a
magnifier, voice control, switch access). Please do not include a key or
private text.

## What was tested, and what was not

Tested:

- Unit tests for the saved choices, the attributes they set on the page, the
  shortcuts list, the filter that keeps read aloud to local voices, the
  contrast of every token pair in four themes, the motion rules, and a scan
  that every icon-only button has a name.
- By hand, in a Chromium browser on macOS with the page's browser preview:
  the skip link, the shortcuts dialog (focus in, Escape, focus back), read
  aloud with a local macOS voice, more contrast in light and dark, and the
  other switches.
- An automated check with axe-core (WCAG 2.0, 2.1 and 2.2 A and AA, and its
  best practices) on the built app on macOS, in dark and light, each with and
  without more contrast: the first run, the chat (an answer with Markdown,
  code and a link, the link's question, the More menu, Clear, attached files,
  a sent picture, Approve cards), the assistant form and its gallery, skills,
  memory and Record how you work, Find anything, the shortcuts list,
  Connections, Mail, Models, Move or back up, Settings and the Docker
  computer. It found three problems, which are fixed. An automated check finds
  only part of what a person meets, so it does not replace testing by hand.

Not tested yet:

- **No screen reader.** We have not tested with VoiceOver, NVDA, JAWS or Orca.
- The packaged desktop app on Windows and Linux, and read aloud there.
- Windows high contrast (forced colours) mode.
- Voice control and switch access.

If you can test any of these, an issue with what you found is very welcome.
