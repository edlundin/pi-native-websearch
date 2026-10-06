# Pi Native Web Search

A Pi extension providing `native_web_search`: a separate provider-native
`web_search` request through an OpenAI-compatible Responses endpoint.
No route-based search service or fallback is used.

## Install

```sh
pi install git:github.com/edlundin/pi-native-websearch
```

Run `/reload` in an existing Pi session. For a pinned release, once published:

```sh
pi install git:github.com/edlundin/pi-native-websearch@v0.1.0
```

If you previously copied this extension into `~/.pi/agent/extensions`, move
that copy outside the extensions directory before loading the package.

## Choose a search model

The default is your current model's connection. Its endpoint and model must
support native `web_search` through `/v1/responses`.

To keep using a dedicated search model when switching your main model:

```text
/native-search-model 9router/cx/gpt-6.1-sol
```

Use the provider/model ID shown by your own `/model` picker. The above model
was tested, but is not a required provider or a universal model name.

`/native-search-model` displays the selection. `/native-search-model current`
restores the current model. Command selections are session-only and reset on
reload. For a persistent startup default, set this before launching Pi:

```sh
export PI_NATIVE_SEARCH_MODEL='9router/cx/gpt-6.1-sol'
pi
```

Then ask Pi to search the web. The main model supplies a query, and the tool
returns a researched answer, citation URLs, and token usage.

## How it works

1. Resolve the selected model, credentials, headers, endpoint overrides, and
   provider environment through Pi's model registry.
2. Use Pi's built-in OpenAI Responses client with the native `web_search`
   tool and `tool_choice: required` for this separate request only.
3. Verify a completed native search, collect citation annotations, and return
   the result to the main model.

The extension reads no proxy configuration or credential files. It works
with a compatible 9router, CLIProxyAPI, or other standard Responses endpoint
configured in Pi. The proxy is responsible for upstream compatibility.

## Compatibility and limitations

- Tested on Pi 1.0.4 and a live 9router Codex route.
- Accepts `openai-completions` and `openai-responses` model entries, but always
  sends search through Responses. An advertised Chat Completions endpoint
  does not guarantee that Responses or native search is supported.
- Direct Codex OAuth, Azure, Anthropic, and other transports are not supported.
  They are rejected rather than sending their credentials to the wrong API.
- Uses Pi's registry for authentication, but bypasses the selected provider's
  custom streaming implementation. Custom transport logic is not preserved.
- Search sees the supplied query, not the main conversation history. Include
  necessary context and date/source restrictions in the query.
- Queries are sent to your chosen provider; normal provider charges apply.
- While active, hides the standalone `ninerouter_web_search` declaration.
  URL-fetch tools and unrelated search tools are unchanged.
- Supports user cancellation and a 120-second request timeout. There is no
  fallback; unconfirmed searches, empty answers, and provider errors fail.
- Token usage is reported to Pi. Cost estimates depend on the model's
  registered pricing and do not separately include search-tool fees.

## Updates and removal

```sh
pi update --extensions
pi remove git:github.com/edlundin/pi-native-websearch
```

Tagged/commit installations stay pinned. Run `/reload` after changes.

## Development

```sh
git clone git@github.com:edlundin/pi-native-websearch.git
cd pi-native-websearch
npm install
npm test
npm run check:package
pi -e .
```

Tests load the real extension using Pi's extension loader and use a local
mock Responses server. They need no API credentials and perform no external
search. Pi runtime packages are peers; development copies are only for tests.

No license has been selected yet; this repository does not currently grant
an open-source license.
