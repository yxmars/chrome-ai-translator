/** Only select original failed paragraphs, never the inserted error/translation UI. */
export function failedParagraphsInRange(
  range: Range,
  failed: Iterable<HTMLElement>,
): HTMLElement[] {
  if (range.collapsed) return [];
  return Array.from(failed).filter(
    (el) => el.isConnected && range.intersectsNode(el),
  );
}

export function paragraphTargetsInRange(range:Range,candidates:Iterable<HTMLElement>,failed:Iterable<HTMLElement>=[]):HTMLElement[]{
 if(range.collapsed)return [];
 const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();
 const full=Array.from(candidates).filter(el=>{
  if(!el.isConnected||!range.intersectsNode(el))return false;
  const contents=el.ownerDocument.createRange();contents.selectNodeContents(el);
  const overlap=range.cloneRange();
  if(range.compareBoundaryPoints(Range.START_TO_START,contents)<0)overlap.setStart(contents.startContainer,contents.startOffset);
  if(range.compareBoundaryPoints(Range.END_TO_END,contents)>0)overlap.setEnd(contents.endContainer,contents.endOffset);
  return !!normalize(el.textContent||'')&&normalize(overlap.toString())===normalize(el.textContent||'');
 });
 return [...new Set([...full,...failedParagraphsInRange(range,failed)])].sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
}
