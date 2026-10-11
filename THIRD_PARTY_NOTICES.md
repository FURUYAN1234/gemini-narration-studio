# Third-party components

- Remotion 4.0.534: [official license](https://github.com/remotion-dev/remotion/blob/v4.0.534/LICENSE.md). Installed through npm; its original license stays in node_modules. Its license conditions apply independently to the user and organization.
- React / React DOM 19.2.3: MIT. Original licenses accompany the installed packages.
- reveal.js 5.2.1 themes: MIT; bundled `runtime/vendor/reveal-LICENSE.txt` and upstream provenance in `sources.json`.
- Noto Sans JP: SIL Open Font License; bundled `runtime/vendor/NotoSansJP-OFL.txt`.
- 180 Gemini TTS preset samples: previously generated generic Japanese preview narration, model/voice/pitch metadata retained. No personal production narration is bundled. Google API terms apply to future API use.
- Chrome Headless Shell and Remotion FFmpeg are installed by the renderer setup; their original package notices apply.

Browser setup uses the official [Remotion ensureBrowser API](https://www.remotion.dev/docs/renderer/ensure-browser). No other Antigravity application is required to render.

- Node.js 22.23.3 Windows x64 portable distribution: automatically downloaded only when supported Node.js/npm is missing, from https://nodejs.org/dist/v22.23.3/. The official archive SHA-256 is pinned in scripts/bootstrap.ps1 and checked before extraction. Node.js license and notices remain in the installed runtime folder.

## Application code and independent terms

The explanatory-scene implementation in runtime/explain-scenes.mjs and runtime/explain-presentation.tsx is original application code under the FURU Application Terms. OpenMontage supplied conceptual inspiration only; its source, templates, assets and packages are not copied, imported or bundled in this distribution. The separately installed OpenMontage project carries its own [AGPL-3.0 license](https://github.com/calesthio/OpenMontage/blob/main/LICENSE) and is not required to use this app.

FURU terms do not replace any third-party terms. Remotion 4.0.534 grants free eligibility to individuals, for-profit organizations with up to three employees, nonprofits, and evaluation before commercial use; other entities need a Company License. The exact versioned license above controls; do not infer permission to relicense or resell Remotion from the FURU terms. Check the current official license/FAQ for your situation.

図解機能はFURU利用条件による独自実装です。OpenMontageは演出の考え方の参考であり、コード・テンプレート・素材・パッケージを取り込んでいません。別途導入したOpenMontageのAGPL-3.0と、本アプリの利用条件を混同しないでください。Remotion、React、フォント等の条件と著作権表示はそれぞれ保持します。
