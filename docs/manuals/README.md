# PDF source / PDF原稿

`api_guide_content.json` is the editable source; `build_api_guide.py` renders A4 Japanese PDFs, page PNGs and bounds/link checks. / JSON原稿から日本語A4 PDF、全ページPNG、境界・リンク検査記録を生成します。

Use the existing cached Python environment with reportlab, Pillow, pypdf, pypdfium2 and pdfplumber; Japanese fonts are BIZ-UDGothicR/B on Windows. Set APP_MANUAL_OUTPUT to a private WSL work directory before running. / 既存のPython環境とWindowsのBIZ UDゴシックを使用。APP_MANUAL_OUTPUTにはWSLの作業領域を指定してください。

After inspecting every rendered page, copy only the final API PDF into docs/. Keep PNGs and QA receipts in the private work directory. / 全ページを確認後、完成API PDFだけをdocs/へ配置し、PNGと検査記録は非公開の作業領域へ残します。


`update_operation_guide.py` appends or updates the emergency-stop supplement in the existing operation PDF. It preserves and pixel-compares the original four pages rather than recreating their illustrations. / 既存操作PDFへ緊急停止の補足を追加・更新し、元の4ページは画像単位で不変を確認して保持します。`APP_MANUAL_OUTPUT`を指定し、補足ページの目視確認後に`narration-guide.pdf`をdocsへ戻します。
