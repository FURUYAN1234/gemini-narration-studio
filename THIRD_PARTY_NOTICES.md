# Third-party components

- Remotion 4.0.428: [official license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md). Installed through npm; its original license stays in node_modules. Its license conditions apply independently to the user and organization.
- React / React DOM 19.2.3: MIT. Original licenses accompany the installed packages.
- reveal.js 5.2.1 themes: MIT; bundled `runtime/vendor/reveal-LICENSE.txt` and upstream provenance in `sources.json`.
- Noto Sans JP: SIL Open Font License; bundled `runtime/vendor/NotoSansJP-OFL.txt`.
- 180 Gemini TTS preset samples: previously generated generic Japanese preview narration, model/voice/pitch metadata retained. No personal production narration is bundled. Google API terms apply to future API use.
- Chrome Headless Shell and Remotion FFmpeg are installed by the renderer setup; their original package notices apply.

Browser setup uses the official [Remotion ensureBrowser API](https://www.remotion.dev/docs/renderer/ensure-browser). No other Antigravity application is required to render.
