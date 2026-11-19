<!--
The notes a new draft release starts with. scripts/release/upload.sh fills in
{{tag}}, {{version}} and {{repo}}. Write the highlights from CHANGELOG.md, and
take out the unsigned warning once a build is signed and notarized.
-->

OpenStellarFirm {{version}}: personal AI assistants that run on your own
computer, on your own model (Ollama, LM Studio, or your own key). No account,
no cloud saving, no telemetry.

## What is new

<!-- The highlights, from the [{{version}}] section of CHANGELOG.md. -->

See [CHANGELOG.md](https://github.com/{{repo}}/blob/{{tag}}/CHANGELOG.md) for
everything.

## These builds are not signed

macOS and Windows will warn you the first time you open the app, because the
builds are not signed or notarized yet. Check the file's SHA-256 sum first
(below), then:

- **macOS:** open the app once, then go to System Settings, Privacy &
  Security, and press **Open Anyway** next to OpenStellarFirm.
- **Windows:** when SmartScreen says it protected your PC, press **More info**,
  then **Run anyway**.

## Download

| System               | File                                                            |
| -------------------- | --------------------------------------------------------------- |
| macOS, Apple silicon | `OpenStellarFirm-{{version}}-mac-arm64.dmg` (or `.zip`)         |
| macOS, Intel         | `OpenStellarFirm-{{version}}-mac-x64.dmg` (or `.zip`)           |
| Windows (x64)        | `OpenStellarFirm-{{version}}-win-x64.exe`                       |
| Linux (x64)          | `OpenStellarFirm-{{version}}-linux-x64.AppImage` (or `.tar.gz`) |

Linux: make the AppImage runnable with `chmod +x`. It needs FUSE; without it,
run it with `--appimage-extract-and-run`. To save keys, the app needs a running
Secret Service keyring, such as GNOME Keyring or KWallet.

## Check the download

Download `SHA256SUMS-mac.txt` (macOS) or `SHA256SUMS.txt` (Windows and
Linux) into the same folder as the file, then:

```bash
# macOS
shasum -a 256 -c SHA256SUMS-mac.txt --ignore-missing
# Linux
sha256sum -c SHA256SUMS.txt --ignore-missing
```

```powershell
# Windows (PowerShell): compare the result with the line in SHA256SUMS.txt
Get-FileHash .\OpenStellarFirm-{{version}}-win-x64.exe -Algorithm SHA256
```

## Licence

Apache License 2.0 with the Commons Clause: free to use, change and share, not
to sell. See [LICENSE](https://github.com/{{repo}}/blob/{{tag}}/LICENSE).
