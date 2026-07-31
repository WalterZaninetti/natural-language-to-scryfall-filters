# natural-language-to-scryfall-filters

Turns natural language — Italian, English, German, French, Spanish — into a validated
[Scryfall](https://scryfall.com/docs/syntax) search filter, plus a ready-to-open
`scryfall.com/search?q=…` URL.

Backend only. No UI in this repo.

## Why validation is the whole point

Scryfall silently ignores filters it can't parse and still returns HTTP 200:

```
GET /cards/search?q=t:creature cmc:banana
→ 200, total_cards: 18618
  warnings: ["Invalid expression “cmc:banana” was ignored. …"]
```

A query like that looks successful and returns 18,618 wrong cards. So every generated
query passes two gates before it is returned:

1. **Whitelist lint** — local, no network. Rejects unknown keys and out-of-vocabulary
   values against a curated registry of 37 operators.
2. **Scryfall probe** — treats a non-empty `warnings` array as failure, not a hint.

A failure at either gate triggers exactly one repair attempt with the specific error fed
back to the model.

## API

### `POST /translate`

```jsonc
{
  "text": "creature rosse economiche con rapidità di Kamigawa",
  "language": "it",                   // optional; auto-detected when absent
  "previous": {                       // omit on a first turn
    "query": "c:r t:creature kw:haste mv<=3",
    "text": "creature rosse economiche con rapidità"
  }
}
```

```jsonc
{
  "query": "c:r t:creature kw:haste mv<=3 (set:chk OR set:bok OR set:sok OR set:neo)",
  "scryfallUrl": "https://scryfall.com/search?q=…",
  "detectedLanguage": "it",
  "assumptions": ["\"economiche\" interpretato come valore di mana 3 o inferiore"],
  "unsupported": [],
  "notes": [],
  "warnings": []                       // non-empty only if repair failed
}
```

Refinement is stateless — the caller holds the last `{text, query}` and posts it back.
A refinement may arrive in a different language than the original turn.

### `GET /health`

Grounding-index age, registry version, store reachability, and daily-budget usage.

### Access and limits

`POST /translate` is **public**. The calling site reaches it same-origin — Firebase Hosting rewrites
`walterzaninetti.com/api/**` here and the Vite dev server proxies the same path — so the browser
sends no credential and none ships in its bundle. A public web app cannot hold a secret, so the
service does not pretend it can: an earlier `Origin` allowlist only looked like a gate, because
`Origin` is set by the caller and forged in one curl flag.

Hosting passes the matched path through unchanged, so requests arrive as `/api/translate`; a
middleware strips the prefix, letting one set of routes serve the rewrite, the dev proxy, and the
direct Cloud Run URL without per-environment configuration.

Two limits bound abuse:

| Limit | Default | Env |
|---|---|---|
| Per-IP, hourly | 15 | `RATE_LIMIT_PER_HOUR` |
| Model calls, daily | 500 | `DAILY_MODEL_CALL_LIMIT` |

The daily ceiling is the one that caps the Anthropic bill — rotating IPs is cheap, so the per-IP
limit only shapes ordinary traffic. Both return `429`, distinguished by the `error` field
(`rate_limited` vs `daily_limit`).

A valid `x-api-key` marks a server-to-server caller (the eval suite, scripts) and skips the per-IP
limit only. It is a convenience tier, not an access control: the daily ceiling still applies.

## Running locally

```sh
cp .env.example .env      # fill in ANTHROPIC_API_KEY and GCP credentials
npm install
npm run dev
```

```sh
curl -s localhost:8080/translate -H 'content-type: application/json' \
  -d '{"text":"cheap red creatures with haste from Kamigawa"}' | jq
```

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Watch-mode server, runs TypeScript sources directly |
| `npm run build` | `tsc` → `dist/` |
| `npm test` | Unit tests — tokenizer and linter. No network, no credentials |
| `npm run test:integration` | Live-Scryfall tests — probe classification, localized names. Network, no credentials |
| `npm run eval` | Eval suite, graded by result-set equivalence, per-language breakdown. **Needs `ANTHROPIC_API_KEY`** |
| `npm run refresh-snapshot` | Re-fetch Scryfall catalogs into the committed fallback snapshot |

## Notes

- **Input language is not a `lang:` filter.** Asking in German means you want Magic cards,
  not German printings. `lang:` appears only when printing language is explicitly requested.
- **Localized card names are canonicalized to English.** `q=Fulmine` returns nothing on
  scryfall.com unless the viewer has multilingual search enabled, so "Fulmine" is resolved
  to `Lightning Bolt` server-side before the query is returned.
- TypeScript is pinned to 6.0.3 because `typescript-eslint` declares `typescript <6.1.0`.
  Check `npm view typescript-eslint peerDependencies` before bumping.
