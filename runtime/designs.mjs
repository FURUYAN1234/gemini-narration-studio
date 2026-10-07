import {safeText} from './production.mjs';
import {MOTION_SCHEMA,normalizeMotion} from './motion.mjs';

export const DESIGN_LAYOUTS=['split','visual','steps','editorial','focus','poster','gallery','rail','stack'];
export const DESIGN_SCHEMA={type:'object',additionalProperties:false,properties:{
 name:{type:'string'},layout:{type:'string',enum:DESIGN_LAYOUTS},
 background:{type:'string'},foreground:{type:'string'},heading:{type:'string'},accent:{type:'string'},
 decoration:{type:'string',enum:['none','line','grid','frame','band']},
 motion:MOTION_SCHEMA,titleSize:{type:'integer',minimum:44,maximum:80},imageSide:{type:'string',enum:['left','right']},
 imageRatio:{type:'number',minimum:.32,maximum:.6},radius:{type:'integer',minimum:0,maximum:32}
},required:['name','layout','background','foreground','heading','accent','decoration','titleSize','imageSide','imageRatio','radius']};
const make=(id,name,description,layout,background,foreground,heading,accent,decoration,titleSize=60,imageSide='right',imageRatio=.46,radius=16)=>({id,name,description,design:{name,layout,background,foreground,heading,accent,decoration,titleSize,imageSide,imageRatio,radius}});
export const VIDEO_TEMPLATES=[
 make('clean','クリーン解説','図と要点を左右に分け、読みやすく整理。','split','#f7f9fc','#34465a','#14243a','#1b57b4','line'),
 make('photo','写真ドキュメント','素材を大きく見せ、説明を重ねる。','visual','#15283b','#f6f9fc','#ffffff','#ffe29a','frame',64),
 make('blueprint','図解ブループリント','方眼と縦の区切りで、仕組みを解説。','editorial','#092e45','#d9eef5','#ffffff','#75d9ff','grid',58,'left',.5,0),
 make('steps','ステップ講座','手順や要点をカードで順番に案内。','steps','#fbf5e9','#3e392e','#282b22','#865211','frame',56),
 make('magazine','雑誌風','大きな見出しと片側の素材で構成。','editorial','#f5efeb','#332d35','#221b26','#922544','line',72,'right',.4,0),
 make('cinema','シネマ字幕','映像を主役に、落ち着いた字幕を添える。','visual','#14161e','#f2f1f7','#ffffff','#a9c6ff','none',52),
 make('pop','ポップ案内','色の帯と丸い素材枠で、親しみやすく。','split','#fff6dc','#4b3440','#33212b','#97324f','band',72,'left',.48,32),
 make('minimal','余白ミニマル','見出しと素材を中央に、静かに見せる。','focus','#ffffff','#253748','#142332','#1c6573','none',56,'right',.48,0),
 make('broadsheet','ニュース紙面','横長の大見出しと、説明・画像の二段構成。','poster','#f4f0e7','#3c3933','#24221e','#8c342b','line',80,'right',.44,0),
 make('gallery','展示ギャラリー','左の見出し、広い画像、下段の要点で作品を紹介。','gallery','#152b29','#e9efdf','#fffdf3','#c5dca3','frame',66,'right',.56,0),
 make('flow','流れ解説','左の素材と、縦につながる番号付きの要点。','rail','#f0f6f5','#294443','#123432','#14665b','line',64,'left',.38,8),
 make('briefing','ブリーフィング','上段に見出し、下段に要点カードと画像を配置。','stack','#17243b','#e7edf5','#ffffff','#e4bd73','band',68,'right',.32,12)
];
const luminance=color=>{const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
export function contrast(a,b){const first=luminance(a),second=luminance(b);return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);}
export function normalizeDesign(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(DESIGN_SCHEMA.properties,key)))throw new Error('INVALID_DESIGN');
 const name=safeText(input.name,80);if(!name||/[<>]/.test(name)||!DESIGN_LAYOUTS.includes(input.layout)||!DESIGN_SCHEMA.properties.decoration.enum.includes(input.decoration)||!['left','right'].includes(input.imageSide))throw new Error('INVALID_DESIGN');
 for(const key of ['background','foreground','heading','accent'])if(typeof input[key]!=='string'||!/^#[0-9a-f]{6}$/i.test(input[key]))throw new Error('INVALID_DESIGN');
 if(!Number.isInteger(input.titleSize)||input.titleSize<44||input.titleSize>80||!Number.isFinite(input.imageRatio)||input.imageRatio<.32||input.imageRatio>.6||!Number.isInteger(input.radius)||input.radius<0||input.radius>32)throw new Error('INVALID_DESIGN');
 if(contrast(input.background,input.foreground)<4.5||contrast(input.background,input.heading)<4.5||contrast(input.background,input.accent)<3)throw new Error('INVALID_DESIGN_CONTRAST');
 return {...Object.fromEntries(DESIGN_SCHEMA.required.map(key=>[key,key==='name'?name:input[key]])),...(input.motion!==undefined?{motion:normalizeMotion(input.motion)}:{})};
}
export function normalizePresentation(input={theme:'moon'}){
 if(!input||!['moon','black','white'].includes(input.theme))throw new Error('INVALID_THEME');
 if(Object.hasOwn(input,'motion')){const {motion,...rest}=input;return {...normalizePresentation(rest),motion:motion===null?null:normalizeMotion(motion)};}
 if(input.mode===undefined){if(Object.keys(input).some(key=>key!=='theme'))throw new Error('INVALID_PRESENTATION');return {theme:input.theme};}
 if(input.mode==='template'){if(!VIDEO_TEMPLATES.some(t=>t.id===input.template)||Object.keys(input).some(key=>!['theme','mode','template'].includes(key)))throw new Error('INVALID_TEMPLATE');return {theme:input.theme,mode:'template',template:input.template};}
 if(input.mode==='ai'){if(Object.keys(input).some(key=>!['theme','mode','instructions','design'].includes(key)))throw new Error('INVALID_PRESENTATION');return {theme:input.theme,mode:'ai',instructions:safeText(input.instructions||'',2000),...(input.design?{design:normalizeDesign(input.design)}:{})};}
 throw new Error('INVALID_PRESENTATION');
}
export function assertDesignReady(presentation){const value=normalizePresentation(presentation);if(value.mode==='ai'&&!value.design)throw new Error('DESIGN_REQUIRED');return value;}
export function presentationDesign(presentation){const value=assertDesignReady(presentation);return value.mode==='ai'?value.design:value.mode==='template'?normalizeDesign(VIDEO_TEMPLATES.find(t=>t.id===value.template).design):null;}
export function presentationMotion(presentation){const value=normalizePresentation(presentation);return Object.hasOwn(value,'motion')?value.motion:value.design?.motion||null;}
