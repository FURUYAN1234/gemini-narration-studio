import {McpServer} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {readFile} from 'node:fs/promises';

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
    body:JSON.stringify({action,...data}),redirect:'error',signal:AbortSignal.timeout(15000)
  });
  const result=await call.json();
  if(!call.ok)throw new Error(/^[A-Z_]+$/.test(result.error)?result.error:'STUDIO_REQUEST_FAILED');
  return result;
}

function tool(name,description,action,inputSchema,readOnlyHint){
  server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint,destructiveHint:false,openWorldHint:false}},async input=>{
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
tool('studio_render_promo','Make a short animated product demo from already imported screenshot asset IDs, with local music and transition sounds enabled by default. Poll studio_project for the verified MP4.','promo',z.object({
  ...identity,title:z.string().min(1).max(90),watermarkEnabled:z.boolean().optional(),soundEnabled:z.boolean().optional(),
  cuts:z.array(z.object({
    image:z.string().regex(/^[a-f0-9]{64}\.(png|jpe?g|webp)$/),
    title:z.string().min(1).max(66),caption:z.string().max(120).optional(),seconds:z.number().int().min(3).max(8).optional()
  }).strict()).min(1).max(6)
}).strict(),false);
await server.connect(new StdioServerTransport());
