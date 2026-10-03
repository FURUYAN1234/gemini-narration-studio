// Rendering must wait for the bundled Japanese font, or fail rather than
// silently exporting frames with missing glyphs. No remote font requests.
export async function loadLocalFont({FontFace,fonts,url,family,delayRender,handle=delayRender('Load presentation Japanese font'),continueRender,cancelRender}) {
  try {
    const font=new FontFace(family,`url("${url}") format("truetype")`,{weight:'100 900',style:'normal'});
    await font.load();fonts.add(font);continueRender(handle);return true;
  } catch(error) {cancelRender(error);return false;}
}
