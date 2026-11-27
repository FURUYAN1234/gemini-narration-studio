"""Append/update the emergency-stop supplement while preserving the original guide."""
import hashlib
import json
import logging
import os
from pathlib import Path
import runpy

import pypdfium2 as pdfium
from pypdf import PdfReader, PdfWriter

logging.getLogger('pypdf').setLevel(logging.ERROR)
root = Path(__file__).resolve().parents[2]
out = Path(os.environ['APP_MANUAL_OUTPUT'])
guide = root / 'docs/narration-guide.pdf'
marker = 'narration-emergency-stop-supplement'
source = PdfReader(guide)
count = len(source.pages) - (1 if source.metadata.get('/Subject') == marker else 0)
old = pdfium.PdfDocument(guide)
before = [hashlib.sha256(old[i].render(scale=.5).to_pil().tobytes()).hexdigest() for i in range(count)]
old.close()

builder = runpy.run_path(str(Path(__file__).with_name('build_api_guide.py')))
builder['DATA']['manual'] = [{
    'title': '補足　紹介動画・演出・MCP',
    'lead': '台本に合わせた演出、冒頭タイトル、紹介動画フォームとMCPの使い方です。',
    'blocks': [
        ['text', '新規制作は「冒頭にタイトルと読み上げを入れる」が初期状態で有効です。手入力でも、冒頭タイトルとひらがなの読みを確定し、タイトルを読んでから本文に進みます。アプリ紹介では正式名を入力します。'],
        ['text', '自動演出をオンにして①で声選びへ進むと、今の台本の提案がない場合はGeminiを1回利用します。台本・タイトル・手動で指定した声は保持します。背景・場面の配置・切り替えと声は②と③で確認できます。'],
        ['text', '短尺紹介は最大6カットです。見出しと字幕をGeminiへ送り、演出案を1回作ります。BGMは初期状態でオンで、Lyriaで1回作曲します。完成MP4はページ下部で再生・保存できます。'],
        ['text', '末尾には使用した制作環境を表示します。タイトル欄で作品名・作者名・公開URLを任意設定できます。登録した作者クレジットの表示はウォーターマークで切り替えます。'],
        ['text', '紹介動画でHyperFramesを使うには、展開フォルダーで start_narration_studio.bat --install-hyperframes --setup-only を実行します。再起動後は「書き出し方式」の「自動」で選ばれます。未導入ならRemotionを使用します。'],
        ['text', 'MCPは導入ガイドに沿って登録し、制作画面で接続を許可します。録画から操作手順を表示でき、MCPでは強調枠や比較図も指定できます。書き出したMP4は、途中の字幕と末尾の見出しまで再生して確認してください。'],
        ['text', '読みと声を確定すると、音声を作るAPIの実行回数と料金の案内が表示されます。「ナレーション音声だけ作成」を押すと、音声の合成が始まります。短尺紹介にナレーションを入れる場合は、タイトルの読み上げと本文のWAV・MP3を別々に指定します。手入力フォームとMCPで共通です。'],
        ['text', '音声の自動検査は制作ごとに選びます。明確な誤読や発声の異常では同じ意味の言い換えを1回まで再合成し、再検査します。「要試聴」が付いた場合は元の音声を聞き、採用するか修正してください。'],
        ['box', 'MCPから始めた処理を止めるには「停止して手動に戻る」を押します。通常のAI通信や動画処理には「緊急停止」を使います。「制作画面を一時退避」は待機中の画面を退避します。保存済みの台本・素材・音声は保持します。'],
    ],
}]
supplement, layout = builder['build']('manual')
report = builder['verify'](supplement, layout)
writer = PdfWriter()
for page in source.pages[:count]:
    writer.add_page(page)
writer.add_page(PdfReader(supplement).pages[0])
writer.add_metadata({'/Title': 'ナレーション動画メーカー v' + builder['DATA']['version'] + ' 操作ガイド', '/Subject': marker})
target = out / 'narration-guide.pdf'
writer.write(target)
updated = pdfium.PdfDocument(target)
after = [hashlib.sha256(updated[i].render(scale=.5).to_pil().tobytes()).hexdigest() for i in range(count)]
assert before == after, 'Original guide pages changed'
updated[count].render(scale=1.25).to_pil().save(out / 'renders/narration-guide-supplement.png')
updated.close()
(out / 'operation-guide-qa.json').write_text(json.dumps({
    'version': builder['DATA']['version'], 'pages': count + 1, 'originalPagesPixelIdentical': True,
    'supplement': report, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'OPERATION_GUIDE_SUPPLEMENT_READY pages={count + 1} original-pages-identical=true')
