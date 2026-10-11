export const FRESH_BRIEF={scriptMode:'ai',assetMode:'mixed',instructions:'',script:'',references:{text:'',urls:[]},themeAuto:false,autoDirection:true,titleMode:'auto',voiceMode:'auto'};
export const FRESH_PRESENTATION={explainScenes:'auto',theme:'moon',mode:'template',template:'cinema',motion:{version:1,style:'cinematic',intensity:'standard'}};
export const parseScriptParts=text=>String(text||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
export function scriptActionState(input){
 const {mode,script='',instructions='',hasReferences=false,themeAuto=false,keyConfigured=false,busy=false,finalized=false,inputErrors={}}=input;
 const showAiControls=mode==='ai'||mode==='mixed',showThemeAuto=mode==='ai';
 const canAdopt=!busy&&!finalized&&!inputErrors.script&&parseScriptParts(script).length>0;
 let reason=busy?'BUSY':finalized?'VIDEO_FINALIZED':inputErrors.generation||inputErrors.script||null;
 if(!reason){if(!showAiControls)reason='SCRIPT_OPERATION_NOT_ALLOWED';else if(mode==='mixed'&&!parseScriptParts(script).length)reason='SCRIPT_REQUIRED';else if(mode==='mixed'&&!instructions.trim()||mode==='ai'&&!hasReferences&&!instructions.trim()&&!themeAuto)reason='EMPTY_INSTRUCTIONS';else if(!keyConfigured)reason='API_KEY_REQUIRED';}
 return {canGenerate:reason===null,canAdopt,showAiControls,showThemeAuto,reason};
}
export function assertScriptOperation({operation,brief}){
 const fail=code=>{throw new Error(code);};
 if(operation==='compose'){if(brief.scriptMode!=='ai')fail('SCRIPT_OPERATION_NOT_ALLOWED');if(!brief.instructions?.trim()&&!brief.themeAuto&&!brief.references?.text?.trim()&&!brief.references?.urls?.length&&!brief.hasReferences)fail('EMPTY_INSTRUCTIONS');}
 else if(operation==='rewrite'){if(brief.scriptMode!=='mixed'||brief.themeAuto)fail('SCRIPT_OPERATION_NOT_ALLOWED');if(!parseScriptParts(brief.script).length)fail('SCRIPT_REQUIRED');if(!brief.instructions?.trim())fail('EMPTY_INSTRUCTIONS');}
 else if(operation==='prepare-readings'){if(!parseScriptParts(brief.script).length)fail('SCRIPT_REQUIRED');if(brief.autoDirection===true)fail('SCRIPT_OPERATION_NOT_ALLOWED');}
 else fail('SCRIPT_OPERATION_NOT_ALLOWED');
}
