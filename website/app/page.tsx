'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { auth, configured, localMode, request, type Business, type Category, type Listing, type Match } from '../lib/api';

import EclassLink from '../components/EclassLink';
import RegionPicker from '../components/RegionPicker';
import CategoryHandoff from '../components/CategoryHandoff';
import AssistantChat from '../components/AssistantChat';
import { askAI, chatKey, extractProposals, MIN_CHAT_MESSAGES, proposalKey, proposalSystem, readAiSettings, readChatDir, readList, writeJSON, type AiMessage, type Proposal } from '../lib/assistant';

type View = 'Overview'|'Inputs'|'Outputs'|'Assistant'|'Matches'|'Catalog'|'Messages';
type Room = {conversation_id:string; buyer_title:string; seller_title:string; buyer_name:string; seller_name:string; last_message:string|null};
type Message = {message_id:string; sender_id:string; sender_name:string; content:string; created_at:string};
const nav: View[] = ['Overview','Inputs','Outputs','Assistant','Matches','Messages','Catalog'];
const paths: Record<string,string> = {
  Overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  Inputs:'M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4',
  Outputs:'M12 16V3 M7 8l5-5 5 5 M4 17v4h16v-4',
  Matches:'M8 7H5a4 4 0 0 0 0 8h3 M16 7h3a4 4 0 0 1 0 8h-3 M8 11h8',
  Catalog:'M4 4h6v6H4z M14 14h6v6h-6z M7 10v7h7 M14 4h6v6h-6z',
  Messages:'M21 11a8 8 0 0 1-8 8H5l-4 3V11a8 8 0 0 1 8-8h4a8 8 0 0 1 8 8z',
  Assistant:'M12 3l1.9 5.7 5.7 1.9-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9z',
  Plus:'M12 5v14 M5 12h14', Search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  Arrow:'M5 12h14 M14 7l5 5-5 5', Close:'M6 6l12 12 M6 18 18 6', Check:'M5 12l4 4L19 6',
  Edit:'m15 4 5 5 M4 20l5-1L20 4l-5-3L3 16z', Leaf:'M20 3C5 3 2 9 7 16s15 2 13-13z M5 20l10-10',
  Globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c-5 6-5 12 0 18 5-6 5-12 0-18',
};
function Icon({name,size=20}:{name:string;size?:number}) {return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.Arrow}/></svg>;}
const matchLabels:Record<string,string> = {same_class:'Same category',specific_offer:'More specific offer',broad_offer:'Broader offering',nearby_alternative:'Nearby alternative',unclassified:'Unclassified'};
const initials = (name:string) => name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();

export default function Home() {
  const [view,setView] = useState<View>('Overview');
  const [signedIn,setSignedIn] = useState(localMode);
  const [businesses,setBusinesses] = useState<Business[]>([]), [businessId,setBusinessId] = useState('');
  const [listings,setListings] = useState<Listing[]>([]), [matches,setMatches] = useState<Match[]>([]);
  const [rooms,setRooms] = useState<Room[]>([]), [room,setRoom] = useState<Room|null>(null), [messages,setMessages] = useState<Message[]>([]);
  const [stats,setStats] = useState({classes:0,keywords:0}), [revision,setRevision] = useState(0);
  const [matchDirection,setMatchDirection] = useState<'input'|'output'>('input'), [distance,setDistance] = useState(2);
  const [loading,setLoading] = useState(false), [busy,setBusy] = useState(false), [rowBusy,setRowBusy] = useState('');
  const [error,setError] = useState(''), [toast,setToast] = useState('');
  const [modal,setModal] = useState<'business'|'listing'|'signin'|'match'|'delete'|null>(null);
  const [selectedMatch,setSelectedMatch] = useState<Match|null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{ const el = messageListRef.current; if (el && view==='Messages') el.scrollTop = el.scrollHeight; },[messages,room,view]);
  const [editing,setEditing] = useState<Listing|null>(null), [category,setCategory] = useState<Category|null>(null);
  const [classQuery,setClassQuery] = useState(''), [choices,setChoices] = useState<Category[]>([]);
  const [listDirection,setListDirection] = useState<'input'|'output'>('input');
  const [regions,setRegions] = useState<string[]>([]);
  const [specs,setSpecs] = useState<{key:string;value:string}[]>([]);
  const [catalogQuery,setCatalogQuery] = useState(''), [catalog,setCatalog] = useState<Category[]>([]);
  const [trail,setTrail] = useState<Category[]>([]), [catalogLoading,setCatalogLoading] = useState(false);
  const [isAdmin,setIsAdmin] = useState(false);
  const [proposals,setProposals] = useState<Proposal[]>([]), [proposalBusy,setProposalBusy] = useState(false);
  const [draftTitle,setDraftTitle] = useState('');
  const activeBusiness = businesses.find(b => String(b.business_id) === businessId);
  const inputs = listings.filter(l=>l.direction==='input'), outputs = listings.filter(l=>l.direction==='output');
  const roomsKey = (b:string)=>`biz.rooms.v1.${b}`;
  const messagesKey = (id:string)=>`biz.messages.v1.${id}`;
  const ownId = businessId ? `biz-${businessId}` : '';
  const chatCount = businessId && view==='Inputs' ? readList<AiMessage>(chatKey(businessId)).length : 0;
  const proposalDir = (p:Proposal) => p.direction ?? 'input';
  const inputProposals = proposals.filter(p=>proposalDir(p)==='input'), outputProposals = proposals.filter(p=>proposalDir(p)==='output');
  function proposalCards(list:Proposal[]) {return <div className="listing-grid">{list.map((p,i)=><article className="listing-card" key={i}><div className="card-top"><span className={`label ${proposalDir(p)}`}>PROPOSED</span></div><h3>{p.title}</h3>{p.category_hint&&<p className="muted category-label">{p.category_hint}</p>}{p.reason&&<p className="description">{p.reason}</p>}<div className="chips">{p.quantity&&<span>{p.quantity} {p.unit}</span>}</div><footer><button className="text-button" onClick={()=>useProposal(p)}>Use for a listing<Icon name="Arrow" size={15}/></button></footer></article>)}</div>;}

  async function loadWorkspace() {
    if (!configured || !signedIn) return;
    try {
      const rows = await request<Business[]>('workspace'); setBusinesses(rows);
      setBusinessId(current => rows.some(b=>String(b.business_id)===current) ? current : rows.length ? String(rows[0].business_id) : '');
    } catch(e) {setError((e as Error).message);}
  }
  useEffect(()=>{if (configured) request<typeof stats>('stats').then(setStats).catch(e=>setError(e.message));},[]);
  useEffect(()=>{
    if (!auth) return;
    auth.auth.getSession().then(({data})=>setSignedIn(Boolean(data.session)));
    const {data} = auth.auth.onAuthStateChange((_event,session)=>setSignedIn(Boolean(session)));
    return ()=>data.subscription.unsubscribe();
  },[]);
  useEffect(()=>{void loadWorkspace(); if(!signedIn) {setBusinesses([]);setBusinessId('');setListings([]);setMatches([]);setRooms([]);setRoom(null);}},[signedIn,revision]);
  useEffect(()=>{
    if(!businessId) {setListings([]);setMatches([]);return;}
    let active=true;setLoading(true);setError('');
    Promise.all([request<Listing[]>('listings',{business_id:Number(businessId)}),
      request<Match[]>('matches',{business_id:Number(businessId),direction:matchDirection,distance})])
      .then(([l,m])=>{if(active){setListings(l);setMatches(m);}})
      .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[businessId,revision,matchDirection,distance,view]);
  useEffect(()=>{
    if (!configured || view!=='Catalog') return;
    let active=true;setCatalogLoading(true);
    const timer=setTimeout(()=>{
      const params = catalogQuery.trim() ? {query:catalogQuery} : {parent_id:trail.at(-1)?.node_id ?? null};
      request<Category[]>(catalogQuery.trim() ? 'catalog' : 'catalog_children',params)
        .then(rows=>{if(active)setCatalog(rows);}).catch(e=>{if(active)setError(e.message);})
        .finally(()=>{if(active)setCatalogLoading(false);});
    },250);return()=>{active=false;clearTimeout(timer);};
  },[view,catalogQuery,trail]);
  useEffect(()=>{
    if(modal!=='listing' || !classQuery.trim() || category) {setChoices([]);return;}
    let active=true;
    const timer=setTimeout(()=>request<Category[]>('catalog',{query:classQuery}).then(r=>{if(active)setChoices(r);}).catch(e=>{if(active)setError(e.message);}),250);
    return()=>{active=false;clearTimeout(timer);};
  },[modal,classQuery,category]);
  useEffect(()=>{if(modal) modalRef.current?.showModal(); else modalRef.current?.close();},[modal]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6500);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    if(!configured || !signedIn) {setIsAdmin(false);return;}
    request('admin_overview').then(()=>setIsAdmin(true)).catch(()=>setIsAdmin(false));
  },[signedIn]);
  useEffect(()=>{
    if(view!=='Messages'||!businessId)return;
    setRooms(readList<Room>(roomsKey(businessId)));
  },[view,signedIn,revision,businessId]);
  useEffect(()=>{
    if(!room || view!=='Messages')return;
    setMessages(readList<Message>(messagesKey(room.conversation_id)));
  },[room,view,revision]);
  useEffect(()=>{
    setProposals(businessId ? readList<Proposal>(proposalKey(businessId)) : []);
  },[businessId,revision,view]);

  function newListing(direction:'input'|'output', selected?:Category, edit?:Listing, presetTitle='') {
    if (!signedIn) {setModal('signin');return;}
    if (!activeBusiness) {setModal('business');return;}
    setDraftTitle(presetTitle);
    setEditing(edit??null);setListDirection(direction);setRegions(edit?.regions??[]);
    const picked = selected ?? (edit ? {node_id:edit.class_node_id,name:edit.class_name,code:edit.code,description:null,level:null,is_other:false} : null);
    setCategory(picked);setClassQuery(picked?.name??'');
    setSpecs(edit ? Object.entries(edit.attributes).map(([key,value])=>({key,value: typeof value==='string'?value:JSON.stringify(value)})) : []);
    setError('');setModal('listing');
  }
  async function submitBusiness(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();setBusy(true);setError('');
    const form=new FormData(e.currentTarget);
    try {
      const result=await request<Business>('create_business',{name:form.get('name'),representative_name:form.get('representative_name')});
      setBusinessId(String(result.business_id));setRevision(x=>x+1);setModal(null);setToast('Your business workspace is ready.');
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function submitListing(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!category){setError('Choose a catalog category first.');return;}setBusy(true);setError('');
    const form=new FormData(e.currentTarget);const publish=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='publish';
    try {
      const attributes:Record<string,unknown>={};
      for(const spec of specs) if(spec.key.trim()) {
        if(Object.hasOwn(attributes,spec.key.trim())) throw new Error('Each specification must have a different name.');
        let value:unknown=spec.value; if(spec.value==='true'||spec.value==='false'||/^-?(0|[1-9]\d*)(\.\d+)?$/.test(spec.value)) value=JSON.parse(spec.value);
        attributes[spec.key.trim()]=value;
      }
      const saved=await request<Listing>('save_listing',{business_id:Number(businessId),listing_id:editing?.listing_id,
        direction:listDirection,kind:form.get('kind'),class_node_id:category.node_id,title:form.get('title'),description:form.get('description'),
        quantity:form.get('quantity')||null,quantity_unit:form.get('unit')||null,
        regions,
        available_from:form.get('from')||null,available_until:form.get('until')||null,attributes});
      setEditing(saved);
      if(publish) await request('listing_state',{listing_id:saved.listing_id,state:'published'});
      setDraftTitle('');setModal(null);setRevision(x=>x+1);setToast(publish?'Your listing is published.':'Draft saved. Publish it when you are ready.');
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function deleteBusiness() {
    if(!businessId||!activeBusiness)return;
    const name = activeBusiness.name;
    setBusy(true);setError('');
    try {
      await request('delete_business',{business_id:Number(businessId)});
      for (const r of readList<Room>(roomsKey(businessId))) localStorage.removeItem(messagesKey(r.conversation_id));
      localStorage.removeItem(roomsKey(businessId));
      localStorage.removeItem(chatKey(businessId));
      localStorage.removeItem(proposalKey(businessId));
      setBusinessId('');setRoom(null);setModal(null);setRevision(x=>x+1);
      setToast(`Deleted ${name}. Its listings, conversations, and assistant data are gone.`);
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  }
  async function changeState(listing:Listing,state:string) {
    setRowBusy(listing.listing_id);setError('');
    try{await request('listing_state',{listing_id:listing.listing_id,state});setRevision(x=>x+1);setToast(state==='published'?'Listing published.':'Listing withdrawn.');}
    catch(e){setError((e as Error).message);}finally{setRowBusy('');}
  }
  function startChat(match:Match) {
    if(!businessId||!activeBusiness)return;
    const key=roomsKey(businessId);
    const fresh:Room={conversation_id:crypto.randomUUID(),buyer_title:match.buyer_title,seller_title:match.seller_title,
      buyer_name:match.buyer_representative_name,seller_name:match.seller_representative_name,last_message:null};
    const kept=readList<Room>(key).filter(r=>r.buyer_title!==fresh.buyer_title||r.seller_title!==fresh.seller_title);
    writeJSON(key,[fresh,...kept]);
    setRoom(fresh);setModal(null);setView('Messages');setRevision(x=>x+1);
    setToast('Conversations stay in this browser and are not shared with the other business.');
  }
  function sendMessage(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!room||!businessId||!activeBusiness)return;
    const form=e.currentTarget;const content=String(new FormData(form).get('content')||'').trim();
    if(!content)return;
    const msg:Message={message_id:crypto.randomUUID(),sender_id:ownId,sender_name:activeBusiness.name,content,created_at:new Date().toISOString()};
    writeJSON(messagesKey(room.conversation_id),[...readList<Message>(messagesKey(room.conversation_id)),msg]);
    writeJSON(roomsKey(businessId),readList<Room>(roomsKey(businessId)).map(r=>r.conversation_id===room.conversation_id?{...r,last_message:content.slice(0,120)}:r));
    form.reset();setRevision(x=>x+1);
  }
  async function generateProposals() {
    if(!businessId)return;
    const transcript=readList<AiMessage>(chatKey(businessId));
    if(transcript.length<MIN_CHAT_MESSAGES){setView('Assistant');return;}
    const {apiKey,model,base}=readAiSettings();
    if(!apiKey){setView('Assistant');setToast('Add your AI key to generate proposals.');return;}
    setProposalBusy(true);setError('');
    try {
      const dir=readChatDir(businessId);
      const raw=await askAI(apiKey,model,base,proposalSystem(inputs.filter(l=>l.state==='published').map(l=>l.title),dir),transcript);
      const found=extractProposals(raw).map(p=>({...p,direction:dir}));
      writeJSON(proposalKey(businessId),[...found,...proposals.filter(p=>proposalDir(p)!==dir)]);setProposals(readList<Proposal>(proposalKey(businessId)));
      if(!found.length) setToast('Not enough detail yet — chat more with the assistant.');
      else setToast(`${found.length} proposed input${found.length>1?'s':''} ready for review.`);
    } catch(e){setError((e as Error).message);} finally{setProposalBusy(false);}
  }
  async function openListingFor(node_id:number, title='', direction:'input'|'output'='input') {
    try {
      const found = await request<Category>('catalog_category',{node_id});
      newListing(direction,found,undefined,title);
    } catch(e) { setError((e as Error).message); }
  }
  async function useProposal(p:Proposal) {
    const direction = proposalDir(p);
    if (p.class_node_id) {
      try {
        const found = await request<Category>('catalog_category',{node_id:p.class_node_id});
        newListing(direction,found,undefined,p.title);
        return;
      } catch(e) { setError((e as Error).message); }
    }
    newListing(direction,undefined,undefined,p.title);
    setClassQuery(p.category_hint||p.title);
  }
  function listingCard(l:Listing) {return <article className="listing-card" key={l.listing_id}>
    <div className="card-top"><span className={`label ${l.direction}`}>{l.direction==='input'?'NEED':'OFFER'}</span><span className={`state ${l.state}`}><i/>{l.state}</span></div>
    <h3>{l.title}</h3><p className="muted category-label">{l.class_name}</p><EclassLink code={l.code} admin={isAdmin}/>
    {l.description&&<p className="description">{l.description}</p>}
    <div className="chips"><span>{l.kind}</span>{l.quantity&&<span>{l.quantity} {l.quantity_unit}</span>}{l.regions.map(r=><span key={r}><Icon name="Globe" size={12}/>{r}</span>)}</div>
    <footer><button className="text-button" onClick={()=>newListing(l.direction,undefined,l)}><Icon name="Edit" size={15}/>Edit</button>
      <button className="text-button" disabled={rowBusy===l.listing_id} onClick={()=>changeState(l,l.state==='published'?'withdrawn':'published')}>{rowBusy===l.listing_id?'Saving…':l.state==='published'?'Withdraw':'Publish'}<Icon name="Arrow" size={15}/></button></footer>
  </article>;}
  function matchCard(m:Match) {const counterparty=matchDirection==='input'?m.seller_business_name:m.buyer_business_name;
    return <article className="match-card" key={m.request_listing_id+m.offer_listing_id}>
      <div className="company-mark">{initials(counterparty)}</div><div className="match-content"><span className="eyebrow">{counterparty}</span>
      <h3>{matchDirection==='input'?m.seller_title:m.buyer_title}</h3><p className="muted">For your {matchDirection==='input'?'need':'offer'}: {matchDirection==='input'?m.buyer_title:m.seller_title}</p>
      <div className="chips"><span className={m.match_type==='same_class'?'compatible':''}><Icon name="Check" size={13}/>{matchLabels[m.match_type]}</span>
      {m.unknown_requirements.length>0&&<span>{m.unknown_requirements.length} details to confirm</span>}</div></div>
      <div className="match-action"><div className="score"><strong>{m.score}</strong><span>match score</span></div><button className="secondary" onClick={()=>{setSelectedMatch(m);setModal('match');}}>View connection<Icon name="Arrow" size={15}/></button></div>
    </article>;}

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href={`${process.env.NEXT_PUBLIC_BASE_PATH||''}/`} aria-label="circular home"><img className="brand-logo" src={`${process.env.NEXT_PUBLIC_BASE_PATH||''}/image/circular.svg`} alt="circular logo" width={37} height={37}/><span className="brand-name">circular</span></a>
      <div className="sidebar-caption">YOUR WORKSPACE</div><nav aria-label="Main navigation">{nav.map(item=><button key={item} className={view===item?'active':''} onClick={()=>{setView(item);setError('');}}><Icon name={item}/>{item}{item==='Matches'&&matches.length>0&&<span className="count">{matches.length}</span>}</button>)}</nav>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span><strong>{view}</strong></div><div className="account-actions">
      {businesses.length>0&&<select aria-label="Active business" value={businessId} onChange={e=>{setBusinessId(e.target.value);setRoom(null);}}>{businesses.map(b=><option key={b.business_id} value={String(b.business_id)}>{b.name}</option>)}</select>}
      {activeBusiness&&<button className="text-button" onClick={()=>{setError('');setModal('delete');}}>Delete business</button>}
      <button className="account" onClick={()=>setModal(signedIn?'business':'signin')}><span className="avatar">{activeBusiness?initials(activeBusiness.name):'+'}</span>{activeBusiness?'Add business':signedIn?'Create business':'Sign in'}</button>
      {signedIn&&!localMode&&<button className="text-button" onClick={()=>auth?.auth.signOut()}>Sign out</button>}
    </div></header>
    <main>
      {!configured&&<div className="notice">This site is ready to connect. Add your Supabase URL and public key at build time to enable search, publishing, and matching.</div>}
      {error&&<div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><Icon name="Close" size={16}/></button></div>}
      {toast&&<div className="toast" role="status"><Icon name="Check" size={16}/>{toast}</div>}
      {view==='Overview'&&<>
        <div className="page-heading"><div><span className="eyebrow">BUSINESS, CONNECTED</span><h1>Your next opportunity<br/>starts with a connection.</h1><p>Share what you need. Show what you offer. Find the businesses that fit.</p></div><button className="primary" disabled={!configured} onClick={()=>newListing('input')}><Icon name="Plus" size={17}/>Create a listing</button></div>
        <section className="hero-panel"><div><span className="hero-kicker"><span className="status-dot"/>A NETWORK BUILT AROUND YOUR BUSINESS</span><h2>Where supply<br/>meets demand.</h2><p>Connect through a shared product and service catalog.<br/>Go from a compatible match to a real conversation.</p><button onClick={()=>setView('Matches')}>Explore your matches<Icon name="Arrow" size={18}/></button></div><div className="connection-art" aria-hidden="true"><div className="art-label top">WHAT YOU NEED</div><div className="art-node first"><Icon name="Inputs" size={32}/></div><div className="art-line"><span/><span/><span/></div><div className="art-node second"><Icon name="Outputs" size={32}/></div><div className="art-label bottom">WHAT THEY OFFER</div><div className="art-check"><Icon name="Check" size={18}/></div></div></section>
        <div className="stats-grid"><button onClick={()=>setView('Inputs')}><span className="stat-icon input"><Icon name="Inputs"/></span><div><span>Published needs</span><strong>{inputs.filter(l=>l.state==='published').length.toString().padStart(2,'0')}</strong></div><Icon name="Arrow" size={18}/></button><button onClick={()=>setView('Outputs')}><span className="stat-icon output"><Icon name="Outputs"/></span><div><span>Published offers</span><strong>{outputs.filter(l=>l.state==='published').length.toString().padStart(2,'0')}</strong></div><Icon name="Arrow" size={18}/></button><button onClick={()=>setView('Matches')}><span className="stat-icon match"><Icon name="Matches"/></span><div><span>Potential connections</span><strong>{matches.length.toString().padStart(2,'0')}</strong></div><Icon name="Arrow" size={18}/></button></div>
        <section><div className="section-heading"><div><h2>Made for your business</h2><p>Matches based on your published needs and offers.</p></div><button className="text-button" onClick={()=>setView('Matches')}>View all matches<Icon name="Arrow" size={16}/></button></div>
          {matches.length?matches.slice(0,3).map(matchCard):<div className="empty-card"><div className="empty-icon"><Icon name="Matches" size={28}/></div><h3>Make your first connection</h3><p>{activeBusiness?'Publish a need or offer to discover compatible businesses.':'Create your business workspace, then tell the network what you need.'}</p><button className="secondary" disabled={!configured} onClick={()=>activeBusiness?newListing('input'):setModal(signedIn?'business':'signin')}>{activeBusiness?'Publish a need':'Set up your business'}<Icon name="Arrow" size={16}/></button></div>}
        </section><div className="catalog-banner"><span className="catalog-glyph"><Icon name="Catalog" size={24}/></span><div><strong>A shared catalog. A clearer fit.</strong><p>{stats.classes?`${stats.classes.toLocaleString('en-US')} product and service classifications`:'Products and services, organized by category'} — with a place for Other in every collection.</p></div><button className="text-button" onClick={()=>setView('Catalog')}>Browse catalog<Icon name="Arrow" size={16}/></button></div>
      </>}
      {(view==='Inputs'||view==='Outputs')&&<><div className="page-heading"><div><span className="eyebrow">YOUR BUSINESS PROFILE</span><h1>{view==='Inputs'?'What your business needs.':'What your business provides.'}</h1><p>{view==='Inputs'?'Publish products and services you need, and discover potential suppliers.':'Share your capabilities so the right buyers can find you.'}</p></div><button className="primary" disabled={!configured} onClick={()=>newListing(view==='Inputs'?'input':'output')}><Icon name="Plus" size={17}/>Add {view==='Inputs'?'a need':'an offer'}</button></div>
        <div className="list-toolbar"><span>{(view==='Inputs'?inputs:outputs).length} listings</span><span>Drafts are visible only to your business.</span></div>
        {loading?<div className="empty-card">Loading your listings…</div>:(view==='Inputs'?inputs:outputs).length?<div className="listing-grid">{(view==='Inputs'?inputs:outputs).map(listingCard)}</div>:<div className="empty-card"><Icon name={view} size={34}/><h3>{view==='Inputs'?'What do you need to grow?':'What can your business offer?'}</h3><p>Start with a catalog category and add the details that matter.</p><button className="secondary" disabled={!configured} onClick={()=>newListing(view==='Inputs'?'input':'output')}>Create your first listing<Icon name="Arrow" size={16}/></button></div>}
        {view==='Inputs'&&<section style={{marginTop:'38px'}}><div className="section-heading"><div><h2>Proposed inputs</h2><p>Suggested by the AI from your assistant chats. Stored only in this browser.</p></div><button className="secondary" disabled={proposalBusy} onClick={generateProposals}>{proposalBusy?'Reading your chats…':inputProposals.length?'Refresh proposals':'Generate proposals'}</button></div>
          {chatCount<MIN_CHAT_MESSAGES?<div className="empty-card"><Icon name="Assistant" size={30}/><h3>Chat more to unlock proposals</h3><p>The assistant needs a little more about your business first — {MIN_CHAT_MESSAGES-chatCount} more message{MIN_CHAT_MESSAGES-chatCount===1?'':'s'} to go.</p><button className="secondary" onClick={()=>setView('Assistant')}>Chat with the assistant<Icon name="Arrow" size={16}/></button></div>
          :inputProposals.length?proposalCards(inputProposals)
          :<div className="empty-card"><Icon name="Assistant" size={30}/><h3>No proposals yet</h3><p>Generate proposals from your chats, or classify a need with the assistant.</p><button className="secondary" onClick={()=>setView('Assistant')}>Chat with the assistant<Icon name="Arrow" size={16}/></button></div>}</section>}</>}
        {view==='Outputs'&&!!outputProposals.length&&<section style={{marginTop:'38px'}}><div className="section-heading"><div><h2>Proposed offers</h2><p>Classified by the assistant from your descriptions. Stored only in this browser.</p></div></div>{proposalCards(outputProposals)}</section>}
      {view==='Assistant'&&<><div className="page-heading"><div><span className="eyebrow">THINK IT THROUGH</span><h1>Talk it through.</h1><p>Describe your business. The assistant helps establish your inputs and outputs — everything stays in this browser.</p></div></div>
        {activeBusiness?<AssistantChat key={`chat-${businessId}`} businessId={businessId} businessName={activeBusiness.name} onPickCategory={(id)=>openListingFor(id,'',readChatDir(businessId))}/>:<div className="empty-card"><Icon name="Assistant" size={32}/><h3>Set up your business first</h3><p>Create your business workspace, then talk through what it needs and provides.</p><button className="secondary" onClick={()=>setModal(signedIn?'business':'signin')}>{signedIn?'Set up your business':'Sign in'}<Icon name="Arrow" size={16}/></button></div>}</>}
      {view==='Matches'&&<><div className="page-heading"><div><span className="eyebrow">FIND THE RIGHT FIT</span><h1>Better together.</h1><p>Explore compatible businesses. Confirm the details with their representatives.</p></div></div><div className="match-toolbar"><div className="segmented"><button className={matchDirection==='input'?'selected':''} onClick={()=>setMatchDirection('input')}>Find suppliers</button><button className={matchDirection==='output'?'selected':''} onClick={()=>setMatchDirection('output')}>Find buyers</button></div><label>Include alternatives<select value={distance} onChange={e=>setDistance(Number(e.target.value))}><option value={0}>Same category only</option><option value={2}>Nearby categories</option><option value={4}>Wider search</option></select></label></div>
      <p className="match-note">Scores rank category fit. Broader offers, alternatives, and missing details need confirmation.</p>{loading?<div className="empty-card">Finding compatible businesses…</div>:matches.length?matches.map(matchCard):<div className="empty-card"><Icon name="Matches" size={36}/><h3>No matches yet</h3><p>Publish your {matchDirection==='input'?'needs':'offers'} and try a wider category search. New listings can create new connections.</p><button className="secondary" disabled={!configured} onClick={()=>newListing(matchDirection)}>Add a listing<Icon name="Arrow" size={16}/></button></div>}</>}
      {view==='Catalog'&&<><div className="page-heading"><div><span className="eyebrow">ONE SHARED LANGUAGE</span><h1>Find your place in the catalog.</h1><p>Search by name, keyword, or classification code. Browse from broad categories to specific needs.</p></div><span className="catalog-count">{stats.classes?stats.classes.toLocaleString('en-US'):'—'}<small>classifications</small></span></div><div className="search-field"><Icon name="Search"/><input aria-label="Search catalog" placeholder="Try software development, logistics, or a classification code…" value={catalogQuery} onChange={e=>setCatalogQuery(e.target.value)}/>{catalogQuery&&<button aria-label="Clear search" onClick={()=>setCatalogQuery('')}><Icon name="Close" size={16}/></button>}</div>
        {!catalogQuery&&<div className="catalog-trail"><button onClick={()=>setTrail([])}>All categories</button>{trail.map((c,i)=><span key={c.node_id}>/<button onClick={()=>setTrail(trail.slice(0,i+1))}>{c.name}</button></span>)}</div>}
        {trail.length>0&&!catalogQuery&&<div className="selected-category"><div><h3>{trail.at(-1)?.name}</h3><p>{trail.at(-1)?.description||'Select a child category, or publish at this level.'}</p></div><button className="secondary" onClick={()=>newListing('input',trail.at(-1))}>Use this category<Icon name="Plus" size={16}/></button></div>}
        {catalogLoading?<div className="empty-card">Searching the catalog…</div>:<div className="catalog-grid">{catalog.map(c=><article className={`category-card ${c.is_other?'other':''}`} key={c.node_id}><button className="category-browse" onClick={()=>{setCatalogQuery('');setTrail(t=>[...t,c]);}}><span className="category-code">{c.is_other?'OTHER':'CATEGORY'}</span><h3>{c.name}</h3><p>{c.is_other?`For needs outside the named child categories${c.parent_name?` under ${c.parent_name}`:''}.`:c.description||'Explore this classification and its child categories.'}</p><span className="category-foot">{c.parent_name||`Level ${c.level??'—'}`}<Icon name="Arrow" size={17}/></span></button><EclassLink code={c.code} admin={isAdmin}/></article>)}</div>}
        {!catalogLoading&&!catalog.length&&<div className="empty-card"><h3>{catalogQuery?'No categories found':'This is a leaf category'}</h3><p>{catalogQuery?'Try a different keyword or classification code.':'Use this category for your listing, or return to its parent.'}</p></div>}</>}
      {view==='Messages'&&<><div className="page-heading"><div><span className="eyebrow">FROM MATCH TO CONVERSATION</span><h1>From match to message.</h1><p>Conversation notes stay in this browser — they are not sent to the other business or stored elsewhere.</p></div></div><div className="inbox"><div className="room-list">{rooms.map(r=><button key={r.conversation_id} className={room?.conversation_id===r.conversation_id?'selected':''} onClick={()=>setRoom(r)}><strong>{r.buyer_name} · {r.seller_name}</strong><span>{r.seller_title}</span><small>{r.last_message||'Start the conversation'}</small></button>)}{!rooms.length&&<p>No conversations yet. Start one from a business match.</p>}</div><div className="conversation">{room?<><header><strong>{room.buyer_name} ↔ {room.seller_name}</strong><p>{room.buyer_title} / {room.seller_title}</p></header><div className="message-list" ref={messageListRef}>{messages.map(m=><article className={m.sender_id===ownId?'own':''} key={m.message_id}><span>{m.sender_name}</span><p>{m.content}</p><time>{new Date(m.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</time></article>)}{!messages.length&&<p className="muted">Introduce your business and confirm the details of this match.</p>}</div><form onSubmit={sendMessage}><textarea name="content" aria-label="Message" placeholder="Write a message…" maxLength={4000} required/><button className="primary" disabled={busy}>Send<Icon name="Arrow" size={16}/></button></form></>:<div className="empty-card"><Icon name="Messages" size={32}/><h3>Good connections start with a hello.</h3><p>Choose a conversation or discover your next match.</p><button className="secondary" onClick={()=>setView('Matches')}>Explore matches<Icon name="Arrow" size={16}/></button></div>}</div></div></>}
      <footer className="page-footer"><span>circular. Made to fit.</span>{isAdmin&&<Link href="/admin/">Taxonomy admin ↗</Link>}</footer>
    </main></div>
    <dialog ref={modalRef} aria-label={modal==='listing'?'Publish a listing':modal==='business'?'Create business':modal==='signin'?'Sign in':modal==='delete'?'Delete business':'Business connection'} onCancel={e=>{if(busy)e.preventDefault();else setModal(null);}}><div className="dialog-body"><button className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={()=>setModal(null)}><Icon name="Close"/></button>
      {modal==='delete'&&activeBusiness&&<><span className="eyebrow">THIS CANNOT BE UNDONE</span><h2>Delete {activeBusiness.name}?</h2><p className="muted">Its listings, representative links, conversations, chats, and proposals are permanently removed. Other businesses keep their own data.</p><div className="dialog-actions"><button className="secondary" disabled={busy} onClick={()=>setModal(null)}>Keep it</button><button className="primary" disabled={busy} style={{background:'#9b4b35'}} onClick={deleteBusiness}>{busy?'Deleting…':'Delete business'}<Icon name="Arrow" size={16}/></button></div></>}
      {modal==='business'&&<><span className="eyebrow">YOUR PLACE IN THE NETWORK</span><h2>Create your business workspace</h2><p className="muted">Represent your business, publish needs and offers, and find new connections.</p><form onSubmit={submitBusiness}><label>Business name<input name="name" required maxLength={200} placeholder="Your business name"/></label><label>Your name<input name="representative_name" required maxLength={200} placeholder="Your name as a representative"/></label><button className="primary full" disabled={busy}>{busy?'Creating…':'Create workspace'}<Icon name="Arrow" size={17}/></button></form></>}
      {modal==='signin'&&<><span className="eyebrow">WELCOME TO BIZ</span><h2>Good business starts here.</h2><p className="muted">Sign in with an email link to manage your workspace.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);const email=String(new FormData(e.currentTarget).get('email'));try{if(!auth)throw new Error('Supabase sign-in is not configured.');const {error}=await auth.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin+(process.env.NEXT_PUBLIC_BASE_PATH||'')+'/'}});if(error)throw error;setToast('Check your email for your sign-in link.');setModal(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>Email address<input type="email" name="email" placeholder="you@yourbusiness.com" required/></label><button className="primary full" disabled={busy||!auth}>{busy?'Sending…':'Send sign-in link'}<Icon name="Arrow" size={16}/></button></form></>}
      {modal==='listing'&&<><span className="eyebrow">{editing?'EDIT YOUR LISTING':'GROW YOUR BUSINESS PROFILE'}</span><h2>{listDirection==='input'?'What does your business need?':'What can your business provide?'}</h2><p className="muted">Choose a category and the details that define a good fit.</p><form key={`${editing?.listing_id||'new'}::${draftTitle}`} onSubmit={submitListing}><div className="form-row"><label>Listing type<select value={listDirection} onChange={e=>setListDirection(e.target.value as 'input'|'output')}><option value="input">Input — what we need</option><option value="output">Output — what we provide</option></select></label><label>Product or service<select name="kind" defaultValue={editing?.kind||'service'}><option value="service">Service</option><option value="product">Product</option></select></label></div>
        <label>Catalog category<div className="search-field compact"><Icon name="Search" size={17}/><input value={classQuery} onChange={e=>{setClassQuery(e.target.value);setCategory(null);}} placeholder="Search the catalog…" aria-label="Listing category search"/></div></label>
        <CategoryHandoff query={classQuery} onSelect={c=>{setCategory(c);setClassQuery(c.name);}}/>
        {category&&<div className="picked-category"><Icon name="Check" size={16}/><span>{category.name}<small>{!category.code&&(category.parent_name||'Other category')}</small>{category.description&&<small>{category.description}</small>}<EclassLink code={category.code} admin={isAdmin}/></span></div>}
        {choices.length>0&&<div className="category-options">{choices.map(c=><div className="category-option-row" key={c.node_id}><button type="button" onClick={()=>{setCategory(c);setClassQuery(c.name);}}><strong>{c.name}</strong>{!c.code&&<small>Other under {c.parent_name}</small>}{c.description&&<small>{c.description}</small>}</button><EclassLink code={c.code} admin={isAdmin}/></div>)}</div>}
        <div><button type="button" className="text-button" onClick={()=>{setModal(null);setView('Assistant');}}>Unsure about the category? Ask the assistant<Icon name="Arrow" size={15}/></button></div>
        <label>Listing title<input name="title" required maxLength={200} placeholder={listDirection==='input'?'e.g. Python development for our inventory system':'e.g. Software development for growing businesses'} defaultValue={editing?.title||draftTitle}/></label><label>Description<textarea name="description" maxLength={4000} rows={3} defaultValue={editing?.description||''} placeholder="Tell potential partners what matters to your business."/></label>
        <div className="form-row"><label>Quantity (optional)<input name="quantity" type="number" min="0.000001" step="any" defaultValue={editing?.quantity??''} placeholder="100"/></label><label>Unit<input name="unit" defaultValue={editing?.quantity_unit??''} placeholder="hours, units, kg…"/></label></div><RegionPicker title={listDirection==='input'?'Acceptable delivery regions':'Regions you serve'} value={regions} onChange={setRegions}/><div className="form-row"><label>Available from<input name="from" type="date" defaultValue={editing?.available_from??''}/></label><label>Available until (optional)<input name="until" type="date" defaultValue={editing?.available_until??''}/></label></div>
        <div className="spec-heading"><strong>{listDirection==='input'?'Required specifications':'Offered specifications'}</strong><button type="button" className="text-button" onClick={()=>setSpecs(s=>[...s,{key:'',value:''}])}><Icon name="Plus" size={14}/>Add detail</button></div>{specs.map((s,i)=><div className="spec-row" key={i}><input aria-label={`Specification ${i+1}`} placeholder="e.g. language" value={s.key} onChange={e=>setSpecs(xs=>xs.map((x,j)=>j===i?{...x,key:e.target.value}:x))}/><input aria-label={`Value ${i+1}`} placeholder="e.g. python" value={s.value} onChange={e=>setSpecs(xs=>xs.map((x,j)=>j===i?{...x,value:e.target.value}:x))}/><button type="button" aria-label={`Remove specification ${i+1}`} onClick={()=>setSpecs(xs=>xs.filter((_,j)=>j!==i))}><Icon name="Close" size={15}/></button></div>)}
        <div className="dialog-actions"><button className="secondary" type="submit" value="draft" disabled={busy}>Save draft</button><button className="primary" type="submit" value="publish" disabled={busy||!category}>{busy?'Saving…':'Publish listing'}<Icon name="Arrow" size={16}/></button></div></form></>}
      {modal==='match'&&selectedMatch&&<><span className="eyebrow">A POTENTIAL CONNECTION</span><h2>{matchDirection==='input'?selectedMatch.seller_business_name:selectedMatch.buyer_business_name}</h2><span className="match-pill">{matchLabels[selectedMatch.match_type]} · score {selectedMatch.score}</span><div className="match-detail"><small>BUYER’S NEED</small><h3>{selectedMatch.buyer_title}</h3><small>SUPPLIER’S OFFER</small><h3>{selectedMatch.seller_title}</h3><p>{selectedMatch.assessment==='category_match'?'The category and supplied requirements align. Confirm commercial and technical details together.':'This is a candidate connection. Confirm the category fit and missing requirements before agreeing terms.'}</p>{selectedMatch.unknown_requirements.length>0&&<><strong>Details to confirm</strong><ul>{selectedMatch.unknown_requirements.map(r=><li key={r}>{r.replace('attribute:','Specification: ').replaceAll('_',' ')}</li>)}</ul></>}</div><div className="representative"><span className="avatar">{initials(matchDirection==='input'?selectedMatch.seller_representative_name:selectedMatch.buyer_representative_name)}</span><div><strong>{matchDirection==='input'?selectedMatch.seller_representative_name:selectedMatch.buyer_representative_name}</strong><small>Business representative</small></div></div><button className="primary full" disabled={busy} onClick={()=>startChat(selectedMatch)}><Icon name="Messages" size={17}/>{busy?'Opening…':'Start a conversation'}</button></>}
      {modal&&error&&<div className="error" role="alert">{error}</div>}
    </div></dialog>
  </div>;
}
