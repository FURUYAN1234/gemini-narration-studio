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
    'title': 'v1.3.4 補足：緊急停止と制作の中断',
    'lead': 'AI通信・動画処理の停止と、待機中の制作画面の中断は別操作です。',
    'blocks': [
        ['text', '画面右上に固定した赤い「緊急停止（処理を中止）」は、AIが考えている間・応答の受信中・動画処理中に押せます。待機中と停止済みは無効です。初期API未設定・空の制作では欄ごと隠し、キー設定後・ローカル制作・処理中に表示します。'],
        ['text', '緊急停止は現在の中止処理を使います。台本・素材・生成済み音声は保持し、停止処理の終了後に制作を再開できます。API提供元で既に始まった処理・課金の停止は保証しません。'],
        ['box', '「制作画面を一時退避」は、待機中の制作画面を一時退避する別の操作です。内容のない初期画面では無効です。「制作を再開」で同じ内容へ戻ります。AIの再送信、保存済みデータの削除、確定した読みの取り消しではありません。'],
        ['text', '本書前半の既存操作ガイドはそのまま保持しています。この補足は緊急停止の操作と表示に関する更新です。'],
    ],
}]
supplement, layout = builder['build']('manual')
report = builder['verify'](supplement, layout)
writer = PdfWriter()
for page in source.pages[:count]:
    writer.add_page(page)
writer.add_page(PdfReader(supplement).pages[0])
writer.add_metadata({'/Title': 'ナレーション動画メーカー 操作ガイド', '/Subject': marker})
target = out / 'narration-guide.pdf'
writer.write(target)
updated = pdfium.PdfDocument(target)
after = [hashlib.sha256(updated[i].render(scale=.5).to_pil().tobytes()).hexdigest() for i in range(count)]
assert before == after, 'Original guide pages changed'
updated[count].render(scale=1.25).to_pil().save(out / 'renders/narration-guide-supplement.png')
updated.close()
(out / 'operation-guide-qa.json').write_text(json.dumps({
    'version': '1.3.4', 'pages': count + 1, 'originalPagesPixelIdentical': True,
    'supplement': report, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'OPERATION_GUIDE_SUPPLEMENT_READY pages={count + 1} original-pages-identical=true')
