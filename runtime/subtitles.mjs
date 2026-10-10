import {fitText} from './motion.mjs';

// Local timing estimate: reading length, snapped to nearby pauses in existing
// PCM audio. This is not speech recognition or provider word-level timestamps.
export function buildSubtitleCues({caption,speech,bytes,fps,frames}){
 if(!Number.isInteger(fps)||fps<1||!Number.isInteger(frames)||frames<1)throw new Error('INVALID_SUBTITLE_TIMING');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=p=>String.fromCharCode(...bytes.subarray(p,p+4));
 if(bytes.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE'||view.getUint32(4,true)+8!==bytes.length)throw new Error('INVALID_SUBTITLE_WAV');
 let rate=0;const samples=[];
 for(let p=12;p+8<=bytes.length;){const size=view.getUint32(p+4,true),kind=tag(p);if(p+8+size>bytes.length)throw new Error('INVALID_SUBTITLE_WAV');
  if(kind==='fmt '){if(size<16||view.getUint16(p+8,true)!==1||view.getUint16(p+10,true)!==1||view.getUint16(p+22,true)!==16)throw new Error('UNSUPPORTED_SUBTITLE_WAV');rate=view.getUint32(p+12,true);}
  if(kind==='data')for(let i=p+8;i<p+8+size;i+=2)samples.push(view.getInt16(i,true));p+=8+size+(size%2);
 }
 if(!rate||!samples.length)throw new Error('EMPTY_SUBTITLE_WAV');
 const split=text=>[...new Intl.Segmenter('ja',{granularity:'sentence'}).segment(text)].map(s=>s.segment).filter(s=>s.trim()),texts=split(caption),readings=split(speech||caption);
 if(!texts.length||texts.length>frames)throw new Error('INVALID_SUBTITLE_TIMING');
 const weights=texts.map((t,i)=>Math.max(1,[...(readings.length===texts.length?readings[i]:t).replace(/[\p{P}\p{Z}\s]/gu,'')].length)),total=weights.reduce((a,b)=>a+b,0);
 const width=Math.max(1,Math.round(rate*.01)),energy=[];
 for(let i=0;i<samples.length;i+=width){let sum=0;const end=Math.min(samples.length,i+width);for(let j=i;j<end;j++)sum+=samples[j]*samples[j];energy.push(Math.sqrt(sum/(end-i)));}
 const peak=energy.reduce((a,b)=>Math.max(a,b),0),threshold=Math.max(20,peak*.06),pauses=[];
 for(let i=0;i<energy.length;){if(energy[i]>threshold){i++;continue;}const start=i;while(i<energy.length&&energy[i]<=threshold)i++;if(i-start>=12&&start>0&&i<energy.length)pauses.push(Math.round(((start+i)/2)*width/rate*fps));}
 const edges=[0];let cumulative=0;
 for(let i=0;i<texts.length-1;i++){cumulative+=weights[i];const target=frames*cumulative/total,min=edges.at(-1)+1,max=frames-(texts.length-1-i),window=Math.max(fps*.5,frames*.12),candidates=pauses.filter(p=>p>=min&&p<=max&&Math.abs(p-target)<=window);const chosen=candidates.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0]??Math.round(target);edges.push(Math.max(min,Math.min(max,chosen)));}
 edges.push(frames);return texts.map((text,i)=>({text,from:edges[i],to:edges[i+1],timing:'estimated'}));
}
export function captionAtFrame(row,frame){return row.subtitles?row.subtitles.find(c=>frame>=c.from&&frame<c.to)?.text||'':row.caption||'';}

// The same bounded, word-aware line layout is used by every video template.
export function fitSubtitleText(text,{width=1700}={}){
 return fitText(text,{width,height:128,maxSize:34,lineHeight:1.35,balance:true});
}
