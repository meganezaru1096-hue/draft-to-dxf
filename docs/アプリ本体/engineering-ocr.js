// Supervised OCR confusion costs learned locally from authored engineering words.
// Suggestions require user acceptance. Native PDF text is never auto-corrected.
window.DraftOcrDomain={
  normalize(text){return String(text).normalize('NFKC').replace(/\s+/g,'');},
  cleanOcr(text){return String(text).replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])/gu,'$1');},
  distance(source,target,learned=true){
    const a=[...source],b=[...target],counts=window.DraftEngineeringOcrModel?.substitution_counts||{};
    let previous=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      const row=[i];
      for(let j=1;j<=b.length;j++){
        const sub=a[i-1]===b[j-1]?0:(learned ? .3+.7/(1+(counts[a[i-1]+'\t'+b[j-1]]||0)) : 1);
        row[j]=Math.min(previous[j]+1,row[j-1]+1,previous[j-1]+sub);
      }previous=row;
    }return previous[b.length];
  },
  word(text){
    const source=this.normalize(text),terms=window.DraftEngineeringOcrModel?.terms||window.DraftEngineeringTerms||[];
    if(terms.includes(source)||source.length<2||/[0-9A-Za-z±φΦ⌀°]/.test(source))return null;
    const choices=[];
    for(const term of terms){const edits=this.distance(source,term,false);if(edits>Math.max(1,Math.floor([...term].length*.25)))continue;choices.push({term,edits,cost:this.distance(source,term)});}
    choices.sort((a,b)=>a.cost-b.cost||a.edits-b.edits||a.term.localeCompare(b.term));return choices[0]?.term||null;
  },
  suggest(text){
    // Work only on Japanese tokens; retain all dimensions, ASCII identifiers and signs exactly.
    let changed=false;
    const output=String(text).replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu,token=>{const next=this.word(token);if(next&&next!==token){changed=true;return next;}return token;});
    return changed?output:null;
  }
};
