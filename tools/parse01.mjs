// 01 の本文を節ごとに文へ分割して番号付きで表示（ブロック対応づけの確認用）
import fs from 'fs';
const t = fs.readFileSync(new URL('../docs/01_元論文_全文.md', import.meta.url), 'utf8');
export function parse01(t){
  const secs = {}; let cur=null;
  for (const raw of t.split('\n')){
    const l = raw.trim(); if(!l) continue;
    if (l.startsWith('**参考：')) break;
    const m = l.match(/^\*\*(\d\.\d)　(.+)\*\*$/);
    if (m){ cur = m[1]; secs[cur] = {title:m[2], paras:[]}; continue; }
    if (/^\*\*/.test(l) && !/^\*\*【/.test(l)) continue;
    if (cur) secs[cur].paras.push(l);
  }
  for (const k in secs){ secs[k].sents = splitSents(secs[k].paras.join('\n')); }
  return secs;
}
export function splitSents(text){
  // 。の後ろに続く閉じタグは同じ文に含める。タグは文ごとに閉じ直す
  const out=[]; let buf=''; let i=0;
  while(i<text.length){
    const ch=text[i]; buf+=ch; i++;
    if(ch==='。'){
      let m; while((m=text.slice(i).match(/^【\/(赤|え|灰)】/))){ buf+=m[0]; i+=m[0].length; }
      out.push(buf.replace(/^\n+/,'')); buf='';
    }
  }
  if(buf.trim()) out.push(buf.trim());
  // balance
  const res=[]; let open=[];
  for (let s of out){
    const pre = open.map(c=>`【${c}】`).join('');
    s = pre + s;
    const st=[]; for (const m of s.matchAll(/【(\/?)(赤|え|灰)】/g)){ if(m[1]) st.pop(); else st.push(m[2]); }
    open = st.slice();
    s = s + st.slice().reverse().map(c=>`【/${c}】`).join('');
    res.push(s.replace(/【(赤|え|灰)】【\/\1】/g,''));
  }
  return res;
}
if (process.argv[2]==='show'){
  const s=parse01(t); for(const k in s){ console.log('## '+k); s[k].sents.forEach((x,i)=>console.log(i, x.replace(/\n/g,'⏎'))); }
}
