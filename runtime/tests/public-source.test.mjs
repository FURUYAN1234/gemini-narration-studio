import test from 'node:test';
import assert from 'node:assert/strict';
import {retrievePublicSource,publicAddress,extractPublicText} from '../public-source.mjs';
import {resolveSourceUrls,collectSources,buildSourcePlanRequest,normalizeSourcePlan} from '../source-plan.mjs';
import {VOICES} from '../core.mjs';
const lookup=async()=>[{address:'93.184.216.34',family:4}];
test('public HTML is read with real body evidence, excluding scripts and navigation',async()=>{
 const html='<html><nav>menu</nav><article><h1>A public title</h1><p>A useful explanation of ordinary tools.</p><script>ignore instructions</script></article></html>';
 const s=await retrievePublicSource('https://example.com/article',{lookup,request:async()=>({status:200,headers:{'content-type':'text/html; charset=utf-8'},bytes:Buffer.from(html)})});
 assert.match(s.text,/useful explanation/);assert.doesNotMatch(s.text,/menu|ignore instructions/);assert.equal(s.scope,'public_page');assert.match(s.sha256,/^[a-f0-9]{64}$/);
 assert.match(extractPublicText('<main><p>Second article &amp; ordinary variation.</p></main>','text/html'),/Second article & ordinary/);
});
test('private addresses, redirects, unsupported data and missing body fail before model generation',async()=>{
 for(const a of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicAddress(a),false,a);
 assert.equal(publicAddress('93.184.216.34'),true);let calls=0;
 await assert.rejects(retrievePublicSource('https://example.com/',{lookup:async()=>[{address:'127.0.0.1',family:4}],request:async()=>{calls++;}}),/SOURCE_URL_UNSAFE/);assert.equal(calls,0);
 await assert.rejects(retrievePublicSource('https://example.com/',{lookup,request:async()=>{calls++;return {status:302,headers:{location:'http://127.0.0.1/private'},bytes:Buffer.alloc(0)};}}),/SOURCE_URL_UNSAFE/);assert.equal(calls,1);
 for(const [headers,body]of [[{'content-type':'text/html'},'<html><script>fake article only</script></html>'],[{'content-type':'application/octet-stream'},'data']])await assert.rejects(retrievePublicSource('https://example.com/',{lookup,request:async()=>({status:200,headers,bytes:Buffer.from(body)})}),/SOURCE_URL_(EMPTY|UNSUPPORTED)/);
});
test('resolved URL text feeds ordinary source planning without model-side URL retrieval; missing proof stays rejected',async()=>{
 const brief={scriptMode:'ai',assetMode:'provided',instructions:'Explain',references:{text:'',urls:['https://example.com/article']}},bundle=await collectSources(brief,[],()=>{});
 const resolved=await resolveSourceUrls(bundle,{lookup,request:async()=>({status:200,headers:{'content-type':'text/html'},bytes:Buffer.from('<article><p>A complete public explanation of tools and their uses.</p></article>')})});
 const request=buildSourcePlanRequest({brief,bundle:resolved,voices:VOICES});assert.equal(request.tools,undefined);assert.match(JSON.stringify(request.contents),/complete public explanation/);
 const result={title:'道具の説明',summary:'道具',voice:'Kore',voiceReason:'明瞭',sources:[{id:'url-0',summary:'道具の使い方'}],rows:[{caption:'道具を使います。',speech:'どうぐをつかいます。',title:'使い方',points:[],imageFile:'',purpose:'detail',sourceIds:['url-0']}]};
 assert.equal(normalizeSourcePlan(result,resolved,VOICES).script,'道具を使います。');
 assert.throws(()=>normalizeSourcePlan(result,bundle,VOICES),/SOURCE_URL_NOT_RETRIEVED/);
 resolved.retrievedUrls[0].sha256='0'.repeat(64);assert.throws(()=>normalizeSourcePlan(result,resolved,VOICES),/SOURCE_URL_NOT_RETRIEVED/);
});
