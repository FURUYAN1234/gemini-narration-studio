import test from 'node:test';
import assert from 'node:assert/strict';
import {scriptActionState,assertScriptOperation,parseScriptParts} from '../script-flow.mjs';
const base={mode:'ai',script:'',instructions:'',hasReferences:false,themeAuto:false,keyConfigured:true,busy:false,finalized:false,inputErrors:{script:null,generation:null}};
test('reference-only and explicit theme choice work; unspecified blank does not',()=>{
 assert.equal(scriptActionState({...base,hasReferences:true}).canGenerate,true);
 assert.equal(scriptActionState(base).canGenerate,false);
 assert.equal(scriptActionState({...base,themeAuto:true}).canGenerate,true);
});
test('manual adoption needs no key and hidden AI inputs cannot permit composition',()=>{
 const state=scriptActionState({...base,mode:'existing',script:'手入力。',instructions:'残る指示',themeAuto:true,keyConfigured:false});
 assert.equal(state.canAdopt,true);assert.equal(state.canGenerate,false);assert.equal(state.showAiControls,false);
 assert.equal(scriptActionState({...base,mode:'existing',script:'手入力。',inputErrors:{generation:'INVALID_REFERENCE_URL'}}).canAdopt,true);
 assert.throws(()=>assertScriptOperation({operation:'compose',brief:{scriptMode:'existing',instructions:'残る指示'}}),/SCRIPT_OPERATION_NOT_ALLOWED/);
});
test('rewrite requires body and instruction; reading preparation requires exact existing text',()=>{
 assert.equal(scriptActionState({...base,mode:'mixed',instructions:'短く'}).canGenerate,false);
 assert.equal(scriptActionState({...base,mode:'mixed',script:'元の本文'}).canGenerate,false);
 assert.equal(scriptActionState({...base,mode:'mixed',script:'元の本文',instructions:'短く'}).canGenerate,true);
 assert.throws(()=>assertScriptOperation({operation:'prepare-readings',brief:{script:''}}),/SCRIPT_REQUIRED/);
 assert.throws(()=>assertScriptOperation({operation:'prepare-readings',brief:{script:'本文',autoDirection:true}}),/SCRIPT_OPERATION_NOT_ALLOWED/);
});
test('line parsing and locked state are shared across operations',()=>{
 assert.deepEqual(parseScriptParts('一行。\r\n\r\n 二行。 '),['一行。','二行。']);
 for(const lock of ['busy','finalized']){const state=scriptActionState({...base,script:'本文',instructions:'指示',[lock]:true});assert.equal(state.canAdopt,false);assert.equal(state.canGenerate,false);}
});
