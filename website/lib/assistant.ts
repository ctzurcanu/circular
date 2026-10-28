'use client';

export type AiMessage = {role:'user'|'assistant'; content:string; at:string; choices?:Choice[]};
export type ListingDirection = 'input'|'output';
export type Candidate = {node_id:number; name:string; description?:string|null};
export type Leg = {node_id:number; name:string};
export type Choice = {node_id:number; name:string; description?:string|null; path?:string; legs?:Leg[]; why?:string};

/** Choice lines: `[[choice:ID]] why…` — names live on the buttons, never in the line. */
export function extractChoiceWhys(text:string):Array<{id:number; why:string}> {
  const out:Array<{id:number; why:string}> = [];
  for (const line of text.split('\n')) {
    const match = line.match(/\[\[choice:(\d+)\]\]\s*(.*)/);
    if (match) out.push({id:Number(match[1]), why:match[2].trim().slice(0, 500)});
    if (out.length >= 5) break;
  }
  return out;
}

/** `[[choice:ID]]` markers the AI embeds for clickable category buttons. */
export function extractChoices(text:string):number[] {
  const ids:number[] = [];
  for (const match of text.matchAll(/\[\[choice:(\d+)\]\]/g)) ids.push(Number(match[1]));
  return [...new Set(ids)].slice(0, 5);
}

export function stripChoiceMarkers(text:string) {
  // Choice lines live on as buttons; drop them so names do not repeat.
  return text.split('\n').filter(l=>!/\[\[choice:\d+\]\]/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const chatDirKey = (businessId:string) => `biz.ai-chat-dir.v1.${businessId}`;
export function readChatDir(businessId:string):ListingDirection {
  return decodeSetting(store()?.getItem(chatDirKey(businessId)) ?? null, 'input') === 'output' ? 'output' : 'input';
}
export type Proposal = {title:string; category_hint:string; quantity:string; unit:string; reason:string; class_node_id?:number; direction?:ListingDirection};

/** Minimum chat messages before the AI may propose inputs. */
export const MIN_CHAT_MESSAGES = 4;

const AI_KEY = 'biz.ai-key.v1', AI_MODEL = 'biz.ai-model.v1', AI_BASE = 'biz.ai-base.v1';
export const chatKey = (businessId:string) => `biz.ai-chat.v1.${businessId}`;
export const proposalKey = (businessId:string) => `biz.ai-proposals.v1.${businessId}`;

const store = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function readJSON<T>(key:string, fallback:T):T {
  try {
    const raw = store()?.getItem(key);
    return raw ? {...fallback, ...JSON.parse(raw)} as T : fallback;
  } catch { return fallback; }
}

export function readList<T>(key:string):T[] {
  try {
    const raw = store()?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch { return []; }
}

export function writeJSON(key:string, value:unknown) {
  try { store()?.setItem(key, JSON.stringify(value)); } catch { /* storage full or unavailable */ }
}

export const MUSE_BASE = 'https://api.meta.ai/v1', MUSE_MODEL = 'muse-spark-1.3';

/** Accept a pasted full endpoint as well as a bare base URL. */
export function normalizeBase(base:string) {
  return (base || MUSE_BASE).trim().replace(/^"+|"+$/g, '').replace(/\/+$/, '')
    .replace((/\/(chat\/completions|messages|responses)$/), '');
}

/** Settings are stored JSON-encoded; tolerate raw values saved by older builds. */
export function decodeSetting(raw:string|null, fallback:string):string {
  const clean = (value:string) => value.trim().replace(/^"+|"+$/g, '');
  if (raw == null || !raw.trim()) return fallback;
  try {
    const parsed:unknown = JSON.parse(raw);
    return typeof parsed === 'string' && clean(parsed) ? clean(parsed) : fallback;
  } catch { return clean(raw) || fallback; }
}

export function readSetting(key:string, fallback:string) {
  return decodeSetting(store()?.getItem(key) ?? null, fallback);
}

export function readAiSettings() {
  if (typeof localStorage === 'undefined') return {apiKey:'', model:MUSE_MODEL, base:MUSE_BASE};
  // Keys saved before the Muse default keep working: only empty settings take the default.
  return {
    apiKey: readSetting(AI_KEY, ''),
    model: readSetting(AI_MODEL, MUSE_MODEL),
    base: normalizeBase(readSetting(AI_BASE, '')),
  };
}

export function writeAiSettings(apiKey:string, model:string, base:string) {
  writeJSON(AI_KEY, apiKey.trim()); writeJSON(AI_MODEL, model.trim() || MUSE_MODEL);
  writeJSON(AI_BASE, normalizeBase(base));
}

export const CHAT_SYSTEM = 'You are a business analyst assistant inside a B2B directory. ' +
  'Talk with the user to establish what their business needs (inputs: products or services it consumes) ' +
  'and what it provides (outputs). Keep replies short. Do not invent listings.';

/** Split the AI's search-phrase reply into clean one-line queries. */
export function splitQueries(text:string):string[] {
  return text.split('\n').map(l=>l.replace(/^[\s>*\-–\d.)\]]+/, '').trim()).filter(l=>l.length >= 2).slice(0, 4);
}

/**
 * Search terms from distilled phrases: each phrase plus its significant words.
 * The catalog ANDs a phrase's words, so single words carry recall.
 */
export function expandTerms(queries:string[]):string[] {
  const terms:string[] = [];
  for (const q of queries) {
    if (q.trim() && !terms.includes(q.trim())) terms.push(q.trim());
    for (const w of q.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3 && !terms.includes(w)) terms.push(w);
    }
    if (terms.length >= 10) break;
  }
  return terms.slice(0, 10);
}

export async function distillQueries(apiKey:string, model:string, base:string, messages:AiMessage[]):Promise<string[]> {
  const reply = await askAI(apiKey, model, base,
    'Reply with ONLY up to 4 short product/service catalog search phrases (1-4 plain words each), one per line, no numbering or prose. ' +
    'Cover different angles: the technology used, the service activity, and the industry words. ' +
    'Use generic catalog words (e.g. platform software, marketing service), never the business name.',
    messages);
  return splitQueries(reply);
}

export function chatSystemWith(candidates:Candidate[], direction:ListingDirection='input') {
  const framing = direction === 'input'
    ? 'The user is describing what the business NEEDS from others. Frame choices as inputs it may consume, and ask about needs.'
    : 'The user is describing what the business PROVIDES to others. Frame choices as outputs it may offer, and ask about offers.';
  if (!candidates.length) return `${CHAT_SYSTEM} ${framing} Ask one focused clarifying question at a time about their industry, ` +
    'suppliers, customers, quantities, and regions.';
  const list = candidates.map(c=>`${c.node_id}: ${c.name}${c.description ? ` — ${c.description.slice(0, 220)}` : ''}`).join('\n');
  return `${CHAT_SYSTEM} ${framing} Catalog categories that may fit this business (id, name, official definition):\n${list}\n` +
    'Offer up to 5 fitting ones as choices: start the line with the exact marker [[choice:ID]] followed by ' +
    'a one-line why only — never repeat the category name, buttons already show each name and path. The why must describe what the category IS according to its definition above — ' +
    'never stretch it into a business-relationship angle (network means computer networks, not business contacts). ' +
    'Skip candidates whose definition clearly does not fit instead of rationalizing them. ' +
    'If nothing fits well, offer up to 3 closest-available ones anyway: start each why with "Closest available — " and name the mismatch plainly. ' +
    'Offer choices instead of asking which industry they are in when candidates fit. ' +
    'End with one short follow-up question. Never invent a category id; use only the ids listed.';
}

export function proposalSystem(existingInputs:string[], direction:ListingDirection='input') {
  const kind = direction === 'input' ? 'needs' : 'offers';
  return `You turn a conversation into structured business ${kind}. ` +
    (existingInputs.length ? `The business already published these: ${existingInputs.join('; ')}. Do not repeat them. ` : '') +
    `Respond with ONLY a JSON array (no prose, no code fences) of up to 5 proposed ${direction === 'input' ? 'inputs' : 'offers'}, ` +
    'each shaped like {"title":"...","category_hint":"ECLASS-style category name","quantity":"","unit":"","reason":"one sentence"}. ' +
    'If the conversation holds too little to propose anything concrete, respond with [].';
}

export async function askAI(apiKey:string, model:string, base:string, system:string, messages:AiMessage[]):Promise<string> {
  const endpoint = `${normalizeBase(base)}/chat/completions`;
  const response = await fetch(endpoint, {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${apiKey}`},
    body: JSON.stringify({model, messages:[{role:'system',content:system}, ...messages.map(m=>({role:m.role,content:m.content}))]}),
  });
  const result = await response.json().catch(()=>null);
  if (!response.ok) {
    const detail = result?.error?.message || result?.message
      || (result && typeof result === 'object' ? JSON.stringify(result).slice(0, 200) : '');
    const where = `POST ${endpoint} with model "${model}"`;
    throw new Error(detail ? `The AI request failed (${response.status}): ${detail} [${where}]` : `The AI request failed (status ${response.status}). [${where}] Check the API base URL in the AI settings.`);
  }
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('The AI returned an empty reply.');
  return content.trim();
}

export function extractProposals(text:string):Proposal[] {
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed:unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p):p is Record<string,unknown> => typeof p === 'object' && p !== null && typeof (p as {title?:unknown}).title === 'string')
      .map(p => ({
        title: String(p.title).slice(0, 200),
        category_hint: typeof p.category_hint === 'string' ? p.category_hint.slice(0, 200) : '',
        quantity: typeof p.quantity === 'string' ? p.quantity.slice(0, 50) : '',
        unit: typeof p.unit === 'string' ? p.unit.slice(0, 50) : '',
        reason: typeof p.reason === 'string' ? p.reason.slice(0, 500) : '',
      }));
  } catch { return []; }
}
