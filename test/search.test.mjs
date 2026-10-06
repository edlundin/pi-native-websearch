import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// Test-only access to the installed Pi loader; production uses public APIs.
const agentEntry = import.meta.resolve('@earendil-works/pi-coding-agent');
const { loadExtensions } = await import(new URL('./core/extensions/loader.js', agentEntry));

const path = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const loaded = await loadExtensions([path], process.cwd());
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions[0];
const tool = extension.tools.get('native_web_search').definition;
const model = {
  id: 'search-model', name: 'Search', provider: 'mock', api: 'openai-completions',
  baseUrl: 'http://127.0.0.1/v1', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32000, maxTokens: 1024,
};
const context = (overrides = {}) => ({
  model,
  modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'mock-key' }) },
  ...overrides,
});

async function withServer(events, run) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    requests.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    await run(baseUrl, requests);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const complete = {
  type: 'response.completed',
  response: { id: 'response-test', status: 'completed', output: [],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
};

test('registers native tool and hides only route-based search', () => {
  assert.equal(tool.name, 'native_web_search');
  assert.deepEqual(tool.prepareLoadout().hiddenDeclarations, ['ninerouter_web_search']);
  assert(extension.commands.has('native-search-model'));
});

test('uses registry endpoint/auth and requires native search; no confirmed search fails', async () => {
  await withServer([complete], async (baseUrl, requests) => {
    const ctx = context({ modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'resolved-key', baseUrl }) } });
    const result = await tool.execute('test', { query: 'Latest release?' }, undefined, undefined, ctx);
    assert.equal(result.isError, true);
    assert.equal(result.details.searchCompleted, false);
    assert.equal(result.usage.totalTokens, 12);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, '/v1/responses');
    assert.equal(requests[0].authorization, 'Bearer resolved-key');
    assert.equal(requests[0].body.model, 'search-model');
    assert.equal(requests[0].body.tool_choice, 'required');
    assert.deepEqual(requests[0].body.tools, [{ type: 'web_search' }]);
  });
});

test('returns completed search text, citations, and usage', async () => {
  const item = { id: 'msg-test', type: 'message', role: 'assistant', status: 'in_progress', content: [] };
  const annotation = { type: 'url_citation', url: 'https://example.com/release', title: 'Release', start_index: 0, end_index: 6 };
  const events = [
    { type: 'response.created', response: { id: 'response-test' } },
    { type: 'response.web_search_call.completed' },
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Found a release.' },
    { type: 'response.output_text.annotation.added', annotation },
    { type: 'response.output_item.done', item: { ...item, status: 'completed', content: [{ type: 'output_text', text: 'Found a release.', annotations: [annotation] }] } },
    complete,
  ];
  await withServer(events, async baseUrl => {
    const result = await tool.execute('test', { query: 'Find release' }, undefined, undefined, context({ model: { ...model, baseUrl } }));
    assert.notEqual(result.isError, true);
    assert.equal(result.details.searchCompleted, true);
    assert.match(result.content[0].text, /Found a release/);
    assert.match(result.content[0].text, /https:\/\/example.com\/release/);
    assert.deepEqual(result.details.citations, [{ url: annotation.url, title: annotation.title }]);
    assert.equal(result.usage.totalTokens, 12);
  });
});

test('rejects blank queries, unsupported transports, missing models, and auth failure', async () => {
  await assert.rejects(() => tool.execute('t', { query: ' ' }, undefined, undefined, context()), /blank/);
  await assert.rejects(() => tool.execute('t', { query: 'q' }, undefined, undefined, context({ model: { ...model, api: 'anthropic-messages' } })), /not supported/);
  await assert.rejects(() => tool.execute('t', { query: 'q' }, undefined, undefined, context({ model: undefined })), /No search model/);
  await assert.rejects(() => tool.execute('t', { query: 'q' }, undefined, undefined, context({ modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: 'missing credentials' }) } })), /missing credentials/);
});

test('honors cancellation before credential resolution', async () => {
  const controller = new AbortController();
  controller.abort();
  let resolved = false;
  const ctx = context({ modelRegistry: { getApiKeyAndHeaders: async () => { resolved = true; return { ok: true }; } } });
  await assert.rejects(() => tool.execute('t', { query: 'q' }, controller.signal, undefined, ctx));
  assert.equal(resolved, false);
});
