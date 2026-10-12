import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {openBrowser} from '@remotion/renderer';

test('header centers mixed-size title text and retains one readable manual link at wide and narrow widths',async t=>{
 const root=path.resolve(import.meta.dirname,'..');
 const html=await readFile(path.join(root,'runtime/ui/index.html'),'utf8');
 const css=await readFile(path.join(root,'runtime/ui/style.css'),'utf8');
 const browser=await openBrowser('chrome',{browserExecutable:path.join(root,'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe'),logLevel:'error'});
 t.after(()=>browser.close({silent:true}));
 const page=await browser.newPage({context:()=>null,logLevel:'error',indent:false,pageIndex:0,onBrowserLog:null,onLog:()=>{}});
 // Isolated layout fixture uses the actual header and CSS; no API or user state.
 const markup='<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style>'+html.match(/<header[\s\S]*?<\/header>/)[0];
 await page.goto({url:'data:text/html;charset=utf-8,'+encodeURIComponent(markup),timeout:30000});
 for(const width of [1200,800,390]){
  await page.setViewport({width,height:844,deviceScaleFactor:1});
  const observed=await page.evaluate(()=>{
   const title=document.querySelector('.brand span'),brand=title.parentElement,manual=document.querySelector('.manual-button');
   const rect=e=>{const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect();};
   const text=rect(title),box=brand.getBoundingClientRect(),button=manual.getBoundingClientRect();
   return {offset:Math.abs((text.top+text.bottom-box.top-box.bottom)/2),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,manualLeft:button.left,manualRight:button.right,manualCount:document.querySelectorAll('.manual-button').length,extra:document.querySelectorAll('.manual-save').length};
  });
  assert.ok(observed.offset<2,JSON.stringify({width,...observed}));
  assert.equal(observed.manualCount,1);assert.equal(observed.extra,0);
  assert.ok(observed.manualLeft>=0&&observed.manualRight<=width);assert.ok(observed.scrollWidth<=width);
 }
});
