export function videoCredits({provider, settings, music, promo=false, promoAudio=false, renderer}={}) {
  const tools=['ナレーション動画メーカー', renderer==='hyperframes'?'HyperFrames':'Remotion', 'FFmpeg'];
  if(provider==='gemini'&&settings?.model) tools.push('Gemini TTS · '+settings.model);
  if(music?.model) tools.push('Google Lyria · '+music.model);
  if(promo) tools.push('製品紹介テンプレート');
  if(promoAudio) tools.push('BGM・効果音（アプリ内生成）');
  return tools;
}
