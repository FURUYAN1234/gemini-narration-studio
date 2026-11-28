import {readFile,mkdir,writeFile,cp} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {secureHtml,verifyBuiltSecurity} from './web-security.mjs';
import {makeSkillArchive} from '../mcp/skill-archive.mjs';
export async function buildPublic(root){
 const pkg=JSON.parse(await readFile(new URL('../package.json',root),'utf8'));
 const source=await readFile(new URL('../index.html',root),'utf8');
 const html=secureHtml(source.replaceAll('{{VERSION}}',pkg.version));
 verifyBuiltSecurity(html);
 const skillArchive=await makeSkillArchive(fileURLToPath(new URL('../',root)));
 await mkdir(new URL('../dist/',root),{recursive:true});
 await writeFile(new URL('../dist/index.html',root),html);
 await writeFile(new URL('../dist/narrated-video-production.zip',root),skillArchive);
 await cp(new URL('../docs/screenshots/',root),new URL('../dist/screenshots/',root),{recursive:true});
 await cp(new URL('../public/LICENSE.txt',root),new URL('../dist/LICENSE.txt',root));
 for(const name of ['narration-guide.pdf','narration-api-guide.pdf']) await cp(new URL('../docs/'+name,root),new URL('../dist/'+name,root));
 return html;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await buildPublic(import.meta.url);
