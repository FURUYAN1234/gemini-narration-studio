import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {BlockList,isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import {normalizeReferences} from './production.mjs';
const fail=code=>{throw new Error(code);},limit=4*1024*1024;
const blocked=new BlockList();
for(const [address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(address,prefix,'ipv4');
for(const [address,prefix]of [['2001::',32],['2001:db8::',32],['2002::',16]])blocked.addSubnet(address,prefix,'ipv6');
export function publicAddress(address){const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&/^[23][0-9a-f]{3}:/i.test(address)&&!blocked.check(address,'ipv6');}
async function pinnedRequest(url,address,{signal}={}){
 return new Promise((resolve,reject)=>{
  const req=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{signal,agent:false,headers:{'User-Agent':'NarrationStudio/1.0 public-source-reader','Accept':'text/html,text/plain,application/json','Accept-Encoding':'identity'},lookup:(host,opts,cb)=>cb(null,opts.all?[address]:address.address,address.family)},res=>{
   let size=0;const parts=[];res.on('data',b=>{size+=b.length;if(size>limit)req.destroy(new Error('SOURCE_URL_CONTENT_LIMIT'));else parts.push(b);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)}));
  });req.on('error',reject);req.end();
 });
}
export function extractPublicText(body,mime){
 if(mime==='text/plain'||mime==='application/json')return body.trim();
 let clean=body.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|template|svg|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 clean=(clean.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)||clean.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)||clean.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)||[null,clean])[1];
 clean=clean.replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/section)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ');
 const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
 return clean.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>{if(e[0]!=='#')return entities[e.toLowerCase()];const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}).replace(/[\t \r]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export async function retrievePublicSource(raw,{lookup=dnsLookup,request=pinnedRequest,signal}={}){
 let current=raw;const abort=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]);
 for(let redirects=0;redirects<=4;redirects++){
  let u;try{u=new URL(normalizeReferences({text:'',urls:[current]}).urls[0]);}catch{fail('SOURCE_URL_UNSAFE');}
  let addresses;try{addresses=await lookup(u.hostname,{all:true,verbatim:true});}catch{fail('SOURCE_URL_DNS_FAILED');}
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>!publicAddress(a.address)))fail('SOURCE_URL_UNSAFE');
  let response;try{response=await request(u,addresses[0],{signal:abort});}catch(e){fail(e.message==='SOURCE_URL_CONTENT_LIMIT'?'SOURCE_URL_CONTENT_LIMIT':abort.aborted?'SOURCE_URL_TIMEOUT':'SOURCE_URL_FETCH_FAILED');}
  if([301,302,303,307,308].includes(response.status)){if(!response.headers.location)fail('SOURCE_URL_FETCH_FAILED');current=new URL(response.headers.location,u).href;continue;}
  if(response.status!==200)fail('SOURCE_URL_FETCH_FAILED');
  let bytes=response.bytes;if(!Buffer.isBuffer(bytes)||bytes.length>limit)fail('SOURCE_URL_CONTENT_LIMIT');
  try{const encoding=response.headers['content-encoding'];if(encoding&&encoding!=='identity'){const decode={gzip:gunzipSync,deflate:inflateSync,br:brotliDecompressSync}[encoding];if(!decode)fail('SOURCE_URL_UNSUPPORTED');bytes=decode(bytes,{maxOutputLength:limit});}}catch{fail('SOURCE_URL_CONTENT_LIMIT');}
  const type=String(response.headers['content-type']||''),mime=type.split(';')[0].trim().toLowerCase();
  if(!['text/html','application/xhtml+xml','text/plain','application/json'].includes(mime)||/charset\s*=\s*"?(?!utf-8|utf8|us-ascii)[\w-]+/i.test(type))fail('SOURCE_URL_UNSUPPORTED');
  let text;try{text=extractPublicText(new TextDecoder('utf-8',{fatal:true}).decode(bytes),mime);}catch{fail('SOURCE_URL_UNSUPPORTED');}
  if(text.length<20)fail('SOURCE_URL_EMPTY');if(text.length>120000)fail('SOURCE_URL_CONTENT_LIMIT');
  return {url:raw,finalUrl:u.href,text,sha256:createHash('sha256').update(text).digest('hex'),scope:'public_page',retrievedAt:new Date().toISOString()};
 }fail('SOURCE_URL_REDIRECT_LIMIT');
}
