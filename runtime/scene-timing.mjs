// Speech starts stay on the audio timeline. A distinct next shot can open during
// the preceding pause, while adjoining ranges of one recording retain their cut point.
export function planSceneSwitches(rows,endingFrom,gapFrames,fps){
 const lead=Math.min(Math.floor(gapFrames*.4),Math.round(fps*.4));
 const starts=rows.map((row,index)=>{
  const previous=rows[index-1];
  const continuous=previous?.video&&previous.video===row.video&&row.videoStart===previous.videoStart+previous.videoFrames;
  return row.from-(!previous||continuous?0:lead);
 });
 return rows.map((row,index)=>({
  screenFrom:starts[index],
  screenFrames:(starts[index+1]??endingFrom)-starts[index],
  narrationLead:row.from-starts[index],
 }));
}
