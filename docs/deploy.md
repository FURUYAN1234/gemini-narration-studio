# Private local distribution

Root-owned `scripts/release-apps.json` registers `distributionMode: private-local`, Pages disabled, `C:\gemini-narration-studio-main`, and the durable user-profile data directory. The seven existing public applications keep their existing stages. Before every new transaction stage, remote evidence must show the exact repository is private and has no Pages site.

Use the existing formal transaction:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/publish_app_release.ps1 -App gemini-narration-studio -NotesPath C:\Users\sx717\Antigravity\gemini-narration-studio\docs\releases\v1.0.0.md -ReleaseTitle "Gemini Narration Studio v1.0.0"
```

Required stages: preflight, validation, build/package audit, exact source push, annotated tag, exact bilingual Release, Release source ZIP download and C-drive copy parity, private verification. Do not publish Pages or run social announcements. Do not add `-RunFullBackup` merely to register the app with backup. A new full backup remains a separate authorized operation.

The Release source ZIP is runnable after extraction and first-run setup. `node_modules`, browser binaries, personal production data and keys are excluded. Existing data lives outside the replaceable release-copy folder.
