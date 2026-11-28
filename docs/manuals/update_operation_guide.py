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
supplement_count = int(source.metadata.get('/SupplementPages', 1)) if source.metadata.get('/Subject') == marker else 0
count = len(source.pages) - supplement_count
old = pdfium.PdfDocument(guide)
before = [hashlib.sha256(old[i].render(scale=.5).to_pil().tobytes()).hexdigest() for i in range(count)]
old.close()

builder = runpy.run_path(str(Path(__file__).with_name('build_api_guide.py')))
builder['DATA']['manual'] = [{
    'title': '補足　紹介動画・演出・MCP',
    'lead': '台本に合わせた演出、冒頭タイトル、紹介動画フォームとMCPの使い方です。',
    'blocks': [
        ['text', '新規制作では冒頭のタイトル読み上げが有効です。タイトルと読みを確定すると、タイトルから本文へ進みます。アプリ紹介には正式名を入力します。'],
        ['text', '自動演出をオンにして①で声選びへ進むと、今の台本の提案がない場合はGeminiを1回利用します。台本・タイトル・手動で指定した声は保持します。背景・場面の配置・切り替えと声は②と③で確認できます。'],
        ['text', '短尺紹介は最大6カットです。見出しと字幕をGeminiへ送り、演出案を1回作ります。BGMは初期状態でオンで、Lyriaで1回作曲します。完成MP4はページ下部で再生・保存できます。'],
        ['text', '末尾には使用した制作環境を表示します。タイトル欄の作品名・作者名・公開URLは任意です。作者クレジットはウォーターマークで切り替えます。'],
        ['text', 'Windowsでは通常起動時に紹介動画用のHyperFramesと専用FFmpegを準備します。「書き出し方式」の「自動」は準備済みならHyperFrames、準備に失敗したときはRemotionを使います。アプリを起動し直すと準備を再試行できます。'],
        ['text', 'MCPは導入ガイドに沿って登録し、制作画面で許可します。操作録画の強調枠や比較図も指定できます。かぎ括弧と操作名が同じ字幕に入り、声と操作画面が合うことを完成MP4で確認してください。'],
        ['text', '読みと声を確定すると、APIの実行回数と料金の案内が出ます。「ナレーション音声だけ作成」で合成を開始します。短尺紹介の声は、タイトル読み上げと本文のWAV・MP3を別々に指定します。手入力とMCPで共通です。'],
        ['text', '音声の自動検査は制作ごとに選びます。明確な誤読や発声の異常では同じ意味の言い換えを1回まで再合成し、再検査します。「要試聴」が付いた場合は元の音声を聞き、採用するか修正してください。'],
        ['text', '③の「動画のカット間に置く間」は新規制作で標準1.0秒です。別の場面へ移るときは、間の途中で画面が切り替わり、その後に声と字幕が入ります。'],
        ['box', 'MCPから始めた処理を止めるには「停止して手動に戻る」を押します。通常のAI通信や動画処理には「緊急停止」を使います。「制作画面を一時退避」は待機中の画面を退避します。保存済みの台本・素材・音声は保持します。'],
    ],
}, {
    'title': '補足　ナレーションと字幕の公開前確認',
    'lead': '制作スキルを使ったナレーション付き動画の確認手順です。',
    'blocks': [
        ['text', '冒頭タイトルと本文はGemini TTSで生成します。提供元・モデル・声名を記録し、生成結果と書き出しに渡す音声を照合します。Geminiに接続できない場合は音声生成を保留し、理由を伝えます。'],
        ['text', '短尺紹介に声を付ける場合は、タイトルと本文の音声を別々に指定します。字幕は読み上げた文と対応させ、発話の開始・終了に合わせます。章の見出しや要約は、発話字幕とは別に表示してください。'],
        ['box', '完成MP4を順に再生して、声、字幕と操作画面を照合します。公開する場合は確認したMP4を使い、公開先で動画が再生できること、尺とリンクが合うことを確かめます。'],
    ],
}]
supplement, layout = builder['build']('manual')
report = builder['verify'](supplement, layout)
writer = PdfWriter()
for page in source.pages[:count]:
    writer.add_page(page)
new_supplement = PdfReader(supplement)
for page in new_supplement.pages:
    writer.add_page(page)
writer.add_metadata({'/Title': 'ナレーション動画メーカー v' + builder['DATA']['version'] + ' 操作ガイド', '/Subject': marker, '/SupplementPages': str(len(new_supplement.pages))})
target = out / 'narration-guide.pdf'
writer.write(target)
updated = pdfium.PdfDocument(target)
after = [hashlib.sha256(updated[i].render(scale=.5).to_pil().tobytes()).hexdigest() for i in range(count)]
assert before == after, 'Original guide pages changed'
for i in range(count, len(updated)):
    updated[i].render(scale=1.25).to_pil().save(out / f'renders/narration-guide-supplement-{i - count + 1}.png')
updated.close()
(out / 'operation-guide-qa.json').write_text(json.dumps({
    'version': builder['DATA']['version'], 'pages': count + len(new_supplement.pages), 'originalPagesPixelIdentical': True,
    'supplement': report, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'OPERATION_GUIDE_SUPPLEMENT_READY pages={count + len(new_supplement.pages)} original-pages-identical=true')
