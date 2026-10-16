export type ParsedQuery = { original:string; normalized:string; codes:string[]; dimensions:string[]; diameter?:string; weight?:string; terms:string[] };
const aliases: Record<string,string> = { "bu long":"bulong", buloong:"bulong", li:"ly", met:"m", "mét":"m" };
export function normalizeVietnamese(value:string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase().replace(/[x×]/g,"x").replace(/(\d)\s+(ly|li|kg|mm|cm)\b/g,"$1$2").replace(/(\d)li\b/g,"$1ly").replace(/\s+/g," ").trim();
}
export function parseQuery(original:string):ParsedQuery {
  let normalized=normalizeVietnamese(original);
  for (const [from,to] of Object.entries(aliases)) normalized=normalized.replace(new RegExp(`\\b${from}\\b`,"g"),to);
  const tokens=normalized.split(" ").filter(Boolean);
  const codes=tokens.filter(t=>/^(?:\d+[ft]\d*|[a-z]\d{3,}|\d{4})$/i.test(t)).map(t=>t.toUpperCase());
  const dimensions=tokens.filter(t=>/^\d+(?:\.\d+)?x\d+(?:x\d+)?$/i.test(t));
  const diameter=tokens.find(t=>/^\d+(?:\.\d+)?ly$/.test(t))?.replace("ly","") ?? (tokens[tokens.indexOf("phi")+1]?.match(/^\d+(?:\.\d+)?$/)?.[0]);
  const weight=tokens.find(t=>/^\d+(?:\.\d+)?(?:kg|g)$/.test(t));
  return { original, normalized, codes, dimensions, diameter, weight, terms:tokens };
}
export function rankMatch(query:string,target:string,aliasesList:string[]=[]){
  const q=normalizeVietnamese(query), t=normalizeVietnamese(target), aliases=aliasesList.map(normalizeVietnamese);
  if(t===q) return 100; if(t.startsWith(q)) return 85; if(aliases.includes(q)) return 75;
  const hits=q.split(" ").filter(x=>t.includes(x)).length; return hits/q.split(" ").length*60;
}
export function matchesCatalogQuery(query:string,target:string){
  const normalizedQuery=parseQuery(query).normalized;
  const words=normalizeVietnamese(target).split(/\s+/).filter(Boolean);
  return normalizedQuery.split(/\s+/).filter(Boolean).every(term=>
    words.some(word=>word.includes(term)||(!/\d/.test(term)&&term.length>=4&&editDistance(word,term)<=1))
  );
}
function editDistance(a:string,b:string){
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let previous=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){
      const saved=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));
      previous=saved;
    }
  }
  return row[b.length];
}
