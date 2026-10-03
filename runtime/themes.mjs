import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const THEME_NAMES=['moon','black','white'];
export async function themeTokens(name='moon') {
  if(!THEME_NAMES.includes(name))throw new Error('INVALID_THEME');
  const css=await readFile(fileURLToPath(new URL('./vendor/'+name+'.css',import.meta.url)),'utf8');
  const get=key=>{const match=css.match(new RegExp('--r-'+key+':\\s*(#[0-9a-fA-F]{3,8})\\s*;'));if(!match)throw new Error('THEME_SOURCE_INVALID');return match[1];};
  return {name,background:get('background-color'),foreground:get('main-color'),heading:get('heading-color'),accent:get('link-color')};
}
