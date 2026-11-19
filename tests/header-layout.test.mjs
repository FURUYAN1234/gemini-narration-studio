import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {openBrowser} from '@remotion/renderer';

test('toolbar, API labels and promo controls fit without clipping or crowding at wide and narrow widths',async t=>{
 const root=path.resolve(import.meta.dirname,'..');
 const html=await readFile(path.join(root,'runtime/ui/index.html'),'utf8');
 const css=await readFile(path.join(root,'runtime/ui/style.css'),'utf8');
 const browser=await openBrowser('chrome',{browserExecutable:path.join(root,'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe'),logLevel:'error'});
 t.after(()=>browser.close({silent:true}));
 const page=await browser.newPage({context:()=>null,logLevel:'error',indent:false,pageIndex:0,onBrowserLog:null,onLog:()=>{}});
 // Use the actual markup and CSS without starting the API or loading user data.
 const markup=html.replace('</head>','<style>'+css+'</style></head>').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 await page.goto({url:'data:text/html;charset=utf-8,'+encodeURIComponent(markup),timeout:30000});
 for(const width of [1200,800,390]){
  await page.setViewport({width,height:844,deviceScaleFactor:1});
  const observed=await page.evaluate(()=>{
   document.querySelector('.product-intro').open=true;
   document.querySelector('#api-settings').open=true;
   document.querySelector('#api-connection').classList.add('needs-key');
   const title=document.querySelector('.brand span'),brand=title.parentElement,manual=document.querySelector('.top .manual-button');
   const rect=e=>{const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect();};
   const text=rect(title),box=brand.getBoundingClientRect(),button=manual.getBoundingClientRect();
   const apiSummary=document.querySelector('#api-settings > summary'),apiBox=apiSummary.getBoundingClientRect(),apiText=rect(document.querySelector('#api-summary'));
   const buttonsInForm=['#promo-images','#promo-sound','#promo-watermark','#promo-start'].map(selector=>document.querySelector(selector).getBoundingClientRect());
   const gaps=buttonsInForm.slice(1).map((control,i)=>control.top-buttonsInForm[i].bottom);
   const result=document.querySelector('#promo-result');
   const resultAtEnd=Boolean(document.querySelector('#finish').compareDocumentPosition(result)&Node.DOCUMENT_POSITION_FOLLOWING)&&result.nextElementSibling.tagName==='FOOTER'&&result.contains(document.querySelector('#promo-player'));
   return {offset:Math.abs((text.top+text.bottom-box.top-box.bottom)/2),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,manualLeft:button.left,manualRight:button.right,buttons:[...document.querySelectorAll('.top .manual-button')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,href:e.getAttribute('href'),target:e.target})),manualCount:document.querySelectorAll('.top .manual-button').length,extra:document.querySelectorAll('.manual-save').length,apiReadable:apiText.height>0&&apiText.top>=apiBox.top&&apiText.bottom<=apiBox.bottom,apiHeight:apiBox.height,gaps,resultAtEnd};
  });
  assert.ok(observed.offset<2,JSON.stringify({width,...observed}));
  assert.equal(observed.manualCount,2);assert.deepEqual(observed.buttons.map(b=>b.href),['/narration-guide.pdf','/narration-api-guide.pdf']);for(const b of observed.buttons){assert.equal(b.target,'_blank');assert.ok(b.left>=0&&b.right<=width,JSON.stringify({width,b}));}assert.equal(observed.extra,0);
  assert.ok(observed.manualLeft>=0&&observed.manualRight<=width);assert.ok(observed.scrollWidth<=width);
  assert.ok(observed.apiReadable&&observed.apiHeight>=44,JSON.stringify({width,...observed}));
  assert.ok(observed.gaps.every(gap=>gap>=12),JSON.stringify({width,...observed}));
  assert.equal(observed.resultAtEnd,true);
 }
});
