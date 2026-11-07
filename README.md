# CyberAware — SMS Scam Scanner

Plain HTML/CSS/JS front end + a PHP proxy that calls OpenRouter's
**NVIDIA Nemotron 3 Ultra** model to judge whether a pasted SMS message is a scam.

## Files
- `index.html` — the page
- `style.css` — styling
- `script.js` — talks to `proxy.php`
- `proxy.php` — holds the OpenRouter key server-side, calls the model, returns JSON
- `config.example.php` — template for your key

## Setup
1. Get a free OpenRouter API key: https://openrouter.ai/keys
2. Copy `config.example.php` → `config.php` and paste in your key.
3. Upload all files (including `config.php`) to your PHP host (e.g. InfinityFree, same as before).
4. **Do not** make `config.php` publicly browsable outside the folder — don't commit it to a public repo.

## Model
Default: `nvidia/nemotron-3-ultra-550b-a55b:free` — free but rate-limited.
If you hit rate limits often, switch `MODEL` in `config.php` to the paid slug:
`nvidia/nemotron-3-ultra-550b-a55b` (pricing on openrouter.ai).

## How it works
1. User pastes a message and clicks Scan.
2. `script.js` POSTs `{ message }` to `proxy.php`.
3. `proxy.php` sends it to OpenRouter with a system prompt asking for a strict
   JSON verdict (`scam` / `suspicious` / `safe`, a `scam_score` from 0 to 100, confidence,
   why, red flags, recommended action).
4. The JSON is returned to the browser and rendered as a result card.

## Notes
- Requires `curl` enabled in PHP (standard on most shared hosts, including InfinityFree).
- CORS header in `proxy.php` is wide open (`*`) for ease of testing — tighten
  `Access-Control-Allow-Origin` to your own domain once deployed.

## Scam meter
The result card opens with a 0-100 gauge. The model returns `scam_score`; the
page keeps it inside the band of the verdict (safe 0-29, suspicious 30-69,
scam 70-100) so the needle and badge always agree. If no score comes back, a
typical value for the verdict is used. The basic rule-based check converts its
points to a score too.

## Fallback when the AI is unavailable
If the model is down, rate-limited, not configured, or `proxy.php` can't be
reached (or takes longer than 35 seconds), `script.js` automatically runs a
built-in rule-based check (`basicScan`) and shows a short note that the result
is a basic check. It looks for urgency, requests for OTP/KYC details, shortened
or odd links, prize bait, payment requests and similar signs. It is simpler and
less accurate than the AI, so it is only a backup.

## If you still see `{"error":"Could not parse model response."}`
That raw text only appears from an old `script.js`. Upload the new `index.html`,
`script.js` and `style.css` together, then hard-refresh (Ctrl+F5, or clear the
site's cache). The page loads files with `?v=5` so browsers fetch fresh copies.
For model-side parse problems, set `'DEBUG' => true` in `config.php` to see
the model's raw reply start and `finish_reason` in the error response.

## Host "browser check" page (free hosts such as InfinityFree)
If the host answers `proxy.php` with an HTML page (the `aes.js` / "requires
JavaScript" check) instead of JSON, the page reloads once to get a fresh check
cookie and scans again automatically. If that still fails, it uses the basic
rule-based check. The small "v5" in the footer shows which version is live.
