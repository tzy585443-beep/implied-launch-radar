# Reference files for the token-radar-01 entry

This repository starts with no solution at the root on purpose. The official kit starter and the sealed snapshot live here so an agent can author the entry in this session.

- `docs/starter-reference/` is the official make.fun starter (a starting point, not a winner). Copy `vendor/makefun-board.ts` from it unchanged. Do not ship the starter's `main.ts`, `lib/`, `dashboard/`, or `screenshots/` as the entry.
- `docs/input-reference/snapshot.json` is the sealed DefiLlama snapshot the grader also mounts at `/input/snapshot.json`. Use it for local runs: `MAKEFUN_OUTPUT_DIR=out node main.ts --input docs/input-reference/snapshot.json`.
- Do not edit `LICENSE`, `RULES.txt`, or `.makefun/owner.json`.
