# Public local distribution / 公開ローカル配布

The app is registered as public-local in the root release contract. Its public Pages site is an installation/download guide; narration/video creation requires the Windows batch launcher. Existing seven public-app routes remain unchanged. / root契約はpublic-localです。Pagesは導入・ダウンロード案内で、音声・動画制作にはWindowsバッチ起動が必要です。既存7アプリの工程は変更しません。

Use only scripts/publish_app_release.ps1 for the formal transaction: preflight/current security audit, validation, build, exact source push, annotated tag, bilingual Release, Pages, C-drive source-ZIP parity and public verification. / 正式処理はscripts/publish_app_release.ps1のみを使い、当日の監査・検証・build・push・注釈tag・英日Release・Pages・Cコピー・公開確認を完遂します。

Normal local server updates use the limited stop helper after confirming idle; relaunch with --resume to preserve the user's current production. Keys are held in memory and need re-entry only before another provider action. / idle確認後の限定停止helperと--resumeで現在の制作を保全します。メモリのキーは、次のAPI操作が必要なときに画面で再入力します。

Public app files exclude keys, production data, generated media, dependencies and browser profiles. Full backup is a separately authorized operation after publication. / 公開ファイルにキー、制作データ、生成物、依存導入物、ブラウザープロファイルを含めません。フルバックアップは公開後の別の承認済み処理です。
