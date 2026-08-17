# Security

This public demo intentionally contains no production credentials.

- Do not commit AMap keys, security codes, tokens, personal paths, or resume files.
- Store `AMAP_SECURITY_JS_CODE` only in Vercel environment variables.
- Restrict the browser-visible JS API key to the production Vercel domain.
- The AMap proxy only accepts same-origin requests and approved AMap API path prefixes.
- Rotate credentials after accidental exposure.
- Report suspected credential exposure by contacting the repository owner privately.
