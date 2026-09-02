# CivicScan — Online Voting System with Facial Recognition

A front-end demo of a biometric-gated voting flow: **enroll → face scan (with a liveness check) → login → vote → verifiable receipt → live results → tamper-evident audit trail.**

🔗 🔗 **Live Demo:** [Live Demo](https://bhavyatiwari10.github.io/Civic-Scan/)

## Project structure
```
civic-vote-project/
├── index.html      # Page structure (register, scan, login, home/vote, audit screens)
├── css/
│   └── style.css   # All styling, layout, animations, light/dark themes
├── js/
│   └── app.js       # App logic: camera, face detection, audit log, state, storage, voting
└── README.md
```

## How to run
Just open `index.html` in a modern browser (Chrome or Edge recommended — they support
the native `FaceDetector` API used for the scan step). No build step, no server, no
dependencies to install.

If you want to serve it locally instead of opening the file directly (some browsers
restrict camera access on `file://` URLs), run from this folder:
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## How the flow works

1. **Register** (`#screen-register`) — enter a name + voter ID, then capture a
   reference face photo from your webcam. This is your enrollment record.
2. **Face scan gate** (`#screen-scan`) — required *every time* before login. Runs a
   live scanning animation with a simulated **liveness check** step (a nod to how
   real biometric systems try to distinguish a live person from a photo), then
   attempts real on-device detection via the browser's `FaceDetector` API when
   available. If the API or a camera isn't available, it gracefully falls back to
   a simulated scan so the flow never gets stuck.
3. **Login** (`#screen-login`) — only reachable once the face scan has passed for
   this session. Voter ID + password (password is illustrative only in this demo —
   identity is established by the face scan).
4. **Home / Vote** (`#screen-home`) — pick one candidate and submit. One vote per
   enrolled profile is enforced. After voting you get an anonymous **verifiable
   receipt** (a random code + QR) — proof a ballot was cast, without revealing
   which candidate you chose.
5. **Live results tab** — a running tally plus a turnout-over-time chart, both
   rendered as inline SVG.
6. **Audit trail tab** — every enrollment, scan, login, and vote appends a
   **SHA-256 hash-chained entry**. A "Verify chain integrity" button re-derives
   every hash from scratch and flags exactly where tampering occurred, if any.

## What makes this more than a UI mockup

- **Hash-chained tamper-evident audit log** — built with the browser's real
  `crypto.subtle.digest` (SubtleCrypto) API, the same primitive underlying the
  hash-chaining idea behind blockchains and tamper-evident logs. Each entry's hash
  covers its own fields *and* the previous entry's hash, so editing any past entry
  breaks every hash after it. Verifiable on demand, exportable as JSON.
- **Anonymous cryptographic-style receipts** — the audit log records *that* a vote
  was cast (with a receipt code) but deliberately never records *which* candidate,
  demonstrating the real tension in e-voting between verifiability and ballot
  secrecy.
- **Simulated liveness check** — an extra step in the scan sequence, gesturing at
  how real biometric systems try to defeat photo/replay spoofing.
- **Voting-booth-style session timeout** — after a period of inactivity while
  signed in, a countdown warning appears and auto-logs-out, similar to a public
  kiosk security pattern.
- **Turnout timeline chart** and **CSV/JSON export** — hand-built inline SVG, no
  charting library.
- **Light/dark theme toggle**, persisted per device.

## Data & storage
This is a pure front-end demo — no server, no database. Data is stored in the
browser's `localStorage`:
- Your enrollment profile (name, voter ID, face snapshot, voted flag, receipt code).
- Vote tallies and turnout history for the results tab.
- The hash-chained audit log.

**Important limitation:** `localStorage` is per-browser/per-device, so the "live
results" tab reflects votes cast *in that one browser* only — it is **not** a
real multi-user shared tally. Open the app in a different browser (or incognito)
and you'll see a fresh, empty tally. This is intentional for a client-only demo;
see the roadmap below for what a real deployment needs.

## Important: this is a prototype, not production security
Face matching here is a **simulated/demo-level check** (presence detection +
scripted "match" sequence, plus a simulated liveness step), not real biometric
verification against a stored face template. The audit log's hash-chaining is
real cryptography and genuinely detects tampering *within this browser's local
storage*, but it doesn't protect against someone editing `localStorage` directly
and regenerating a consistent chain from scratch — that requires a server-side,
independently-controlled log. Treat this as a UI/UX and interaction-flow
reference — not something to deploy for an actual election.

## Roadmap — what a real deployment needs
This started as an exploration of the UI/UX flow for a voting app. To make it a
genuine, production-grade multi-user system it would need:
- A backend (FastAPI/Flask/Node) with a real database, so votes, tallies, and the
  audit log are shared across users and independently controlled, instead of
  living in one browser's `localStorage`.
- Server-side identity verification, replacing today's client-side face detection.
- Encrypted biometric template storage and real liveness/anti-spoofing checks.
- A server-anchored, append-only ballot store (the audit-log concept here, run
  where a voter can't rewrite their own copy), plus independent security review.

## Customizing
- **Candidates**: edit the `CANDIDATES` array at the top of `js/app.js`.
- **Colors/fonts**: edit the CSS custom properties at the top of `css/style.css`
  (`:root { --ink, --panel, --teal, --gold, ... }`).
- **Copy/labels**: edit the corresponding text directly in `index.html`.
- **Idle timeout**: adjust `IDLE_LIMIT_MS` and `IDLE_COUNTDOWN_S` in `js/app.js`.

---
Created by [Bhavya Tiwari](https://www.linkedin.com/in/bhavya-tiwari-449021297)
