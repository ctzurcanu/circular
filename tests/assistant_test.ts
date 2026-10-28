import { assert, assertEquals } from 'jsr:@std/assert';
import { chatSystemWith, decodeSetting, expandTerms, extractChoices, extractChoiceWhys, MUSE_BASE, MUSE_MODEL, normalizeBase, splitQueries, stripChoiceMarkers } from '../website/lib/assistant.ts';

Deno.test('normalizeBase keeps a bare base URL', () => {
  assertEquals(normalizeBase('https://api.meta.ai/v1'), MUSE_BASE);
});

Deno.test('normalizeBase strips trailing slashes', () => {
  assertEquals(normalizeBase('https://api.meta.ai/v1///'), MUSE_BASE);
});

Deno.test('normalizeBase strips a pasted full endpoint', () => {
  assertEquals(normalizeBase('https://api.meta.ai/v1/chat/completions'), MUSE_BASE);
  assertEquals(normalizeBase('https://api.meta.ai/v1/messages'), MUSE_BASE);
});

Deno.test('normalizeBase falls back to the Muse default', () => {
  assertEquals(normalizeBase(''), MUSE_BASE);
});

Deno.test('normalizeBase strips stray quote characters', () => {
  assertEquals(normalizeBase('"https://api.meta.ai/v1"'), MUSE_BASE);
});

Deno.test('decodeSetting unwraps JSON-encoded values', () => {
  assertEquals(decodeSetting('"https://api.meta.ai/v1"', MUSE_BASE), 'https://api.meta.ai/v1');
  assertEquals(decodeSetting(`"${MUSE_MODEL}"`, 'other'), MUSE_MODEL);
});

Deno.test('decodeSetting tolerates raw and empty values', () => {
  assertEquals(decodeSetting('https://api.meta.ai/v1', MUSE_BASE), 'https://api.meta.ai/v1');
  assertEquals(decodeSetting(null, MUSE_BASE), MUSE_BASE);
  assertEquals(decodeSetting('', MUSE_BASE), MUSE_BASE);
  assertEquals(decodeSetting('""', MUSE_BASE), MUSE_BASE);
});

Deno.test('extractChoices reads choice markers', () => {
  assertEquals(extractChoices('[[choice:12]] Software\n[[choice:34]] Hardware\n[[choice:12]] again'), [12, 34]);
  assertEquals(extractChoices('no markers here'), []);
  assertEquals(stripChoiceMarkers('Intro line.\n[[choice:12]] Software — fits\n[[choice:34]] Hardware\nClosing question?'), 'Intro line.\nClosing question?');
  assertEquals(stripChoiceMarkers('No markers here'), 'No markers here');
});

Deno.test('extractChoiceWhys keeps why text per id', () => {
  assertEquals(extractChoiceWhys('Intro\n[[choice:12]] Closest available — network hardware\n[[choice:34]]\nEnd'), [{id:12, why:'Closest available — network hardware'}, {id:34, why:''}]);
});

Deno.test('chat direction frames needs and offers', () => {
  assert(chatSystemWith([], 'output').includes('PROVIDES'));
  assert(chatSystemWith([], 'input').includes('NEEDS'));
});

Deno.test('splitQueries cleans phrase lines', () => {
  assertEquals(splitQueries('platform software\n2. marketing service\n- consulting'), ['platform software', 'marketing service', 'consulting']);
  assertEquals(splitQueries('just one'), ['just one']);
  assertEquals(splitQueries('a\n\nbe\nsee\ndee'), ['be', 'see', 'dee']);
  assertEquals(splitQueries('aa\nbb\ncc\ndd\nee'), ['aa', 'bb', 'cc', 'dd']);
});

Deno.test('chatSystemWith grounds the why in definitions', () => {
  const prompt = chatSystemWith([{node_id:1, name:'Network management software', description:'Oversees computer network operations.'}]);
  assert(prompt.includes('Oversees computer network operations.'));
  assert(prompt.includes('never stretch it'));
  assert(chatSystemWith([]).includes('clarifying question'));
});

Deno.test('expandTerms adds significant words', () => {
  assertEquals(expandTerms(['catalog management software']), ['catalog management software', 'catalog', 'management', 'software']);
  assertEquals(expandTerms(['b2b networking platform', 'platform software']).length <= 10, true);
});

Deno.test('decodeSetting strips quotes pasted with a key', () => {
  const key = 'LLM_example0123456789_abcDEF123';
  assertEquals(decodeSetting(`"${key}"`, ''), key);
  assertEquals(decodeSetting(JSON.stringify(`"${key}"`), ''), key);
});
