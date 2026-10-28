'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { request, type Category } from '../lib/api';
import { AiMessage, askAI, Candidate, chatDirKey, chatKey, chatSystemWith, distillQueries, expandTerms, extractChoices, extractChoiceWhys, ListingDirection, MUSE_BASE, MUSE_MODEL, readAiSettings, readChatDir, readList, stripChoiceMarkers, writeAiSettings, writeJSON } from '../lib/assistant';

const MUSE_MODELS = ['muse-spark-1.3', 'muse-spark-1.1', 'muse-wonder-1.0'];

export default function AssistantChat({businessId, businessName, onPickCategory}:{businessId:string; businessName:string; onPickCategory:(node_id:number)=>void}) {
  const [settings, setSettings] = useState(readAiSettings);
  const [showSettings, setShowSettings] = useState(!readAiSettings().apiKey);
  const [chat, setChat] = useState<AiMessage[]>(()=>readList<AiMessage>(chatKey(businessId)));
  const [chatDir, setChatDir] = useState<ListingDirection>(()=>readChatDir(businessId));
  function setDir(d:ListingDirection) { setChatDir(d); writeJSON(chatDirKey(businessId), d); }
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{ const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; },[chat]);

  function persist(next:AiMessage[]) { setChat(next); writeJSON(chatKey(businessId), next); }

  async function send(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const content = String(new FormData(e.currentTarget).get('content') || '').trim();
    if (!content || busy) return;
    if (!settings.apiKey) { setShowSettings(true); setError('Add your AI key first — it stays in this browser.'); return; }
    const next:AiMessage[] = [...chat, {role:'user', content, at:new Date().toISOString()}];
    persist(next); e.currentTarget.reset(); setBusy(true); setError('');
    try {
      let candidates:Candidate[] = [];
      try {
        let queries:string[] = [];
        try { queries = await distillQueries(settings.apiKey, settings.model, settings.base, next); } catch { /* fall back below */ }
        if (!queries.length) queries = [content.slice(0, 100)];
        const settled = await Promise.all(expandTerms(queries).map(q => request<Category[]>('catalog', {query:q}).catch(()=>[] as Category[])));
        const seen = new Set<number>();
        for (const found of settled) {
          let taken = 0;
          for (const c of found) {
            if (taken >= 4) break;
            const node_id = Number(c.node_id);
            if (!seen.has(node_id)) { seen.add(node_id); candidates.push({node_id, name:c.name, description:c.description}); taken++; }
            if (candidates.length >= 10) break;
          }
          if (candidates.length >= 10) break;
        }
      } catch { /* search is a bonus; the chat works without it */ }
      const reply = await askAI(settings.apiKey, settings.model, settings.base, `${chatSystemWith(candidates, chatDir)} The business is called "${businessName}".`, next);
      const ids = extractChoices(reply);
      const marked = ids.map(id=>candidates.find(c=>c.node_id===id)).filter((c):c is Candidate=>Boolean(c));
      // Buttons are expected whenever search found anything: fall back to the top results.
      const picked = marked.length ? marked : candidates.slice(0, 3);
      const whys = new Map(extractChoiceWhys(reply).map(w=>[w.id, w.why] as const));
      const withPaths = await Promise.all(picked.map(async c => {
        try {
          const trail = await request<Array<{node_id:number|string; name:string}>>('category_path', {node_id:c.node_id});
          const legs = trail.slice(1).map(t=>({node_id:Number(t.node_id), name:t.name}));
          return {...c, path: trail.map(t=>t.name).join(' › ') || undefined,
            legs: legs.length ? legs : [{node_id:c.node_id, name:c.name}], why: whys.get(c.node_id)};
        } catch { return {...c, legs:[{node_id:c.node_id, name:c.name}], why: whys.get(c.node_id)}; }
      }));
      persist([...next, {role:'assistant', content:stripChoiceMarkers(reply), at:new Date().toISOString(), ...(withPaths.length?{choices:withPaths}:{})}]);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  function saveSettings(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const apiKey = String(form.get('apiKey') || ''), model = String(form.get('model') || ''), base = String(form.get('base') || '');
    writeAiSettings(apiKey, model, base); setSettings(readAiSettings()); setShowSettings(false); setError('');
  }

  return <>
    {showSettings ? <div className="empty-card"><h3>Connect Muse</h3>
      <p>Paste a Muse from Meta API key. It never leaves this browser — chats and the key live in localStorage only. Another OpenAI-compatible endpoint works too.</p>
      <form onSubmit={saveSettings} style={{display:'flex', flexDirection:'column', gap:'10px', textAlign:'left'}}>
        <label style={{fontSize:'11px'}}>Muse API key<input type="password" name="apiKey" defaultValue={settings.apiKey} placeholder="Paste your Meta API key" autoComplete="off" style={{width:'100%', padding:'11px 12px', border:'1px solid #dfe6d5', borderRadius:'5px'}}/></label>
        <div style={{display:'flex', gap:'10px'}}>
          <label style={{fontSize:'11px', flex:1}}>Model<select name="model" defaultValue={MUSE_MODELS.includes(settings.model) ? settings.model : MUSE_MODEL} style={{width:'100%', padding:'11px 12px', border:'1px solid #dfe6d5', borderRadius:'5px'}}>{MUSE_MODELS.map(m=><option key={m} value={m}>{m}</option>)}{!MUSE_MODELS.includes(settings.model)&&settings.model&&<option value={settings.model}>{settings.model} (custom)</option>}</select></label>
          <label style={{fontSize:'11px', flex:1}}>API base URL<input name="base" defaultValue={settings.base} style={{width:'100%', padding:'11px 12px', border:'1px solid #dfe6d5', borderRadius:'5px'}}/></label>
        </div>
        <div style={{display:'flex', gap:'10px'}}><button className="primary" type="submit">Save key</button><button className="secondary" type="button" onClick={()=>{writeAiSettings(settings.apiKey, MUSE_MODEL, MUSE_BASE); setSettings(readAiSettings()); setShowSettings(false); setError('');}}>Reset to Muse defaults</button></div>
      </form></div>
    : <><div className="segmented" role="group" aria-label="Discuss needs or offers" style={{marginBottom:'10px', alignSelf:'flex-start'}}><button type="button" className={chatDir==='input'?'selected':''} onClick={()=>setDir('input')}>What we need</button><button type="button" className={chatDir==='output'?'selected':''} onClick={()=>setDir('output')}>What we provide</button></div><div className="conversation" style={{background:'var(--white)', border:'1px solid var(--line)', borderRadius:'9px', overflow:'hidden'}}>
      <header><strong>Figuring out {businessName}’s {chatDir==='input'?'needs':'offers'}</strong><p>Stored only in this browser · <button type="button" className="text-button" style={{padding:0}} onClick={()=>setShowSettings(true)}>Change AI key</button> · <button type="button" className="text-button" style={{padding:0}} onClick={()=>persist([])}>Start over</button></p></header>
      <div className="message-list" ref={listRef}>{chat.map((m,i)=><article className={m.role==='user'?'own':''} key={i}><span>{m.role==='user'?'You':'Assistant'}</span><p>{m.content}</p>{m.choices&&<div style={{margin:'8px 0'}}>{m.choices.map(c=><div key={c.node_id} style={{margin:'8px 0'}}><div style={{display:'flex', flexWrap:'wrap', gap:'6px'}}>{(c.legs ?? [{node_id:c.node_id, name:c.name}]).map(leg=><button key={leg.node_id} type="button" className="secondary" style={{fontSize:'11px', padding:'7px 10px'}} title={c.description || leg.name} onClick={()=>onPickCategory(leg.node_id)}>{leg.name}</button>)}</div>{c.why&&<p className="muted" style={{fontSize:'12px', margin:'6px 0 0'}}>{c.why}</p>}{!c.why&&c.path&&<p className="muted" style={{fontSize:'12px', margin:'6px 0 0'}}>{c.path}</p>}</div>)}</div>}<time>{new Date(m.at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</time></article>)}{!chat.length&&<p className="muted">Describe your business and the assistant will offer matching catalog categories.</p>}</div>
      {error&&<div className="error" role="alert" style={{margin:'0 24px'}}>{error}</div>}
      <form onSubmit={send}><textarea name="content" aria-label="Message to assistant" placeholder="e.g. We are a bakery selling bread to local shops…" maxLength={4000}/><button className="primary" disabled={busy}>{busy?'Thinking…':'Send'}</button></form>
    </div></>}
  </>;
}
