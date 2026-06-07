# Card Art Mapping (Task A0)

The project now uses the owner-provided named art files in `images/named/`.
`data/cards.json` points each card's `art` field at `named/<file>.jpg`.

## Status

- ✅ **Art APPROVED by owner (2026-06-03).** The mapping is final — no further
  review needed. (The earlier "low-confidence / needs review" picks are resolved.)
- 48 cards have art.
- 48 named source images exist.
- Card ids were not changed.
- The web art build supports these paths because `apps/web/scripts/prepare-art.mjs`
  resolves `art` relative to `images/`.

## Filename Exceptions

Most named files match the card name exactly. These three are intentional aliases:

| Card id | Card name | Source file |
|---|---|---|
| `director-x` | Director X | `named/Industrial Director X.jpg` |
| `infrastructure-audit-x` | Infrastructure Audit X | `named/Infrastructure Auditor X.jpg` |
| `production-overseer-x` | Production Overseer X | `named/Production Overseer.jpg` |

## Verification

Run:

```powershell
npm.cmd run prepare-art --workspace apps/web
```

Expected result:

```text
[prepare-art] plain copy (install sharp for webp): copied 48, skipped 0 (null art), 0 missing source.
```

If `sharp` is installed, the mode text may say `sharp->webp`; copied/skipped/missing
counts should still be `48 / 0 / 0`.
