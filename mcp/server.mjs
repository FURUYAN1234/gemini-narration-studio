import {McpServer} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {readFile} from 'node:fs/promises';
import {DESIGN_LAYOUTS,VIDEO_TEMPLATES} from '../runtime/designs.mjs';
import {TRANSITION_FAMILIES,TRANSITION_TONES} from '../runtime/motion.mjs';

const options=process.argv.slice(2);
const port=options.length===0?6181:options.length===2&&options[0]==='--port'?Number(options[1]):0;
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Use --port followed by the local studio port.');
const origin='http://127.0.0.1:'+port;
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const server=new McpServer({name:'gemini-narration-studio',version});

async function localAction(action,data){
  const response=await fetch(origin+'/api/bootstrap',{redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error('STUDIO_UNAVAILABLE');
  const {token}=await response.json();
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('STUDIO_IDENTITY_MISMATCH');
  const call=await fetch(origin+'/api/mcp-action',{
    method:'POST',headers:{'Content-Type':'application/json','X-Narration-Token':token},
    body:JSON.stringify({action,...data}),redirect:'error',signal:AbortSignal.timeout(action==='promo'?240000:15000)
  });
  const result=await call.json();
  if(!call.ok)throw new Error(/^[A-Z_]+$/.test(result.error)?result.error:'STUDIO_REQUEST_FAILED');
  return result;
}

function tool(name,description,action,inputSchema,readOnlyHint,openWorldHint=false){
  server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint,destructiveHint:false,openWorldHint}},async input=>{
    try{
      const result=await localAction(action,input);
      return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
    }catch(error){
      const code=/^[A-Z_]+$/.test(error.message)?error.message:'STUDIO_UNAVAILABLE';
      const guidance=code==='MCP_ENABLE_IN_STUDIO'?'Open the studio and select MCP接続を許可 for the current project.':code==='STALE_REVISION'?'Read studio_project again and use its current revisions.':code==='STUDIO_UNAVAILABLE'?'Start the Windows studio launcher and verify the local port.':'Read the studio status and resolve this condition before retrying.';
      return {isError:true,content:[{type:'text',text:code+' '+guidance}]};
    }
  });
}

const revision=z.string().regex(/^[a-f0-9]{64}$/);
const identity={projectId:z.string().max(40),revision,productionRevision:revision};
tool('studio_project','Read the current project, imported screenshots and local render status. Requires MCP approval in the app.','project',z.object({}).strict(),true);
tool('studio_render_preview','Render the current prepared narration and artwork for human review. Uses existing audio only. Does not approve or finalize.','preview',z.object(identity).strict(),false);
const recordingFile=z.string().regex(/^[a-f0-9]{64}\.mp4$/);
const recordingStep=z.discriminatedUnion('action',[
  z.object({action:z.literal('click'),target:z.string().min(1).max(120)}).strict(),
  z.object({action:z.literal('fill'),target:z.string().min(1).max(120),text:z.string().max(180)}).strict()
]);
tool('studio_record_demo','Record only the localhost demo URL and exact UI steps approved by the user. Use an unsigned-in demonstration instance with sample data. Poll studio_project for recording.asset.','recording',z.object({
  ...identity,url:z.string().max(500),steps:z.array(recordingStep).min(1).max(7)
}).strict(),false);
tool('studio_edit_recording','Draft ordered cuts and Japanese captions from the names and timing of recorded operations. Call only after the user approves sending those details to Gemini. Never sends footage or entered values. Poll studio_project for recording.edit.','recording-edit',z.object({
  ...identity,file:recordingFile,sendOperationNamesToGemini:z.literal(true)
}).strict(),false,true);
tool('studio_render_promo','Render an animated product demo from imported screenshots or MP4s. Provide a direction from this script and cut list, or set planConsent true after consent for one Gemini request with the cut titles and captions. With music on (default), the same consent authorizes a separate Lyria request. Set soundEnabled false for an offline render with an explicit direction. Auto chooses the installed renderer. For narration, provide a separate titleCall audio asset to open before the body. Set openingTitleRequired to false only for an intentional exception. Poll studio_project for the verified MP4.','promo',z.object({
  ...identity,title:z.string().min(1).max(90),watermarkEnabled:z.boolean().optional(),soundEnabled:z.boolean().optional(),effectsEnabled:z.boolean().optional(),planConsent:z.boolean().optional(),direction:z.object({template:z.enum(VIDEO_TEMPLATES.map(t=>t.id)),motion:z.object({version:z.literal(1),style:z.enum(['cinematic','kinetic','editorial']),intensity:z.enum(['subtle','standard','bold']),transitions:z.array(z.enum(TRANSITION_FAMILIES)).min(1).max(299).optional(),transitionTones:z.array(z.enum(TRANSITION_TONES)).min(1).max(299).optional()}).strict().nullable(),layouts:z.array(z.enum(DESIGN_LAYOUTS).nullable()).min(1).max(6)}).strict().optional(),narration:z.string().regex(/^[a-f0-9]{64}\.(wav|mp3)$/).optional(),titleCall:z.string().regex(/^[a-f0-9]{64}\.(wav|mp3)$/).optional(),openingTitleRequired:z.boolean().optional(),
  renderer:z.enum(['auto','hyperframes','remotion']).optional(),
  cuts:z.array(z.object({
    image:z.string().regex(/^[a-f0-9]{64}\.(png|jpe?g|webp|mp4)$/),
    title:z.string().min(1).max(66),caption:z.string().max(120).optional(),seconds:z.number().int().min(3).max(8).optional(),startFrame:z.number().int().min(0).max(899).optional(),frames:z.number().int().min(18).max(900).optional(),
    holdFrames:z.number().int().min(1).max(882).optional(),
    effect:z.enum(['auto','reveal','focus','steps','comparison']).optional(),
    focus:z.object({x:z.number().min(0).max(100),y:z.number().min(0).max(100),width:z.number().positive().max(100),height:z.number().positive().max(100),label:z.string().min(1).max(35)}).strict().optional(),
    steps:z.array(z.string().min(1).max(28)).min(2).max(4).optional(),
    comparison:z.array(z.object({label:z.string().min(1).max(22),value:z.string().min(1).max(28)}).strict()).length(2).optional()
  }).strict()).min(1).max(6)
}).strict(),false);
await server.connect(new StdioServerTransport());
