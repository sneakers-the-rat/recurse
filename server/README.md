# recurse-server

Optional score tracking for [recurse](../README.md). **The game does not need it.** A build
with no `VITE_RECURSE_API` set never makes a request, and everything below is inert — which is
the point: you can download the game, change it and play it with no server anywhere.

What it adds, when it is there: a player id, an optional username, a record of every round, and
a low score screen at the end of one.

## What it does *not* trust

A client does not post a score. It posts **the round** — the series of actions from
`src/lib/actions.ts`, which is the same vocabulary the screen and a shared link use — and the
server replays it against the real graph with the game's own `replayActions` and `restore`, then
reads the guesses and hints off the result. There is one copy of the rules and this is not
another one. A round that does not replay is refused.

## Setup

    npm install
    cp .env.example .env      # then edit it
    npm run migrate
    npm run dev

The server fetches the puzzle bank and each mode's graph from a running copy of the site at
boot — `RECURSE_DATA` in `.env` — so it needs no build of its own and cannot disagree with the
client about which bank is live. The first request for a given mode pulls that mode's graph
(several MB) and keeps it; expect the first phonemes round of a restart to be slow.

## Running it

    npm install
    npm run build
    npm run migrate
    node dist/main.js

`deploy/recurse-server.service` is an example systemd unit. Put the database somewhere that
gets backed up: it is the only copy of everybody's history.

Behind nginx or Caddy, set `RECURSE_PROXIED=1` so the rate limiter reads `X-Forwarded-For`
rather than rate-limiting your reverse proxy as one very busy player.

## The API

Every path is under `/v1`. Bodies and replies are JSON, and the shapes are in
[`src/lib/api.ts`](../src/lib/api.ts) — the one file both sides import.

| | |
|---|---|
| `POST /v1/players` | mint an anonymous player: `{ id, name: null, token }` |
| `POST /v1/players/register` | bind a username and password to the caller's existing player |
| `POST /v1/players/login` | a token for an existing account |
| `GET /v1/players/me` | who the caller is |
| `PUT /v1/rounds/:puzzle` | submit a round, finished or not. The server scores it |
| `GET /v1/rounds` | this player's history |
| `GET /v1/puzzles/:puzzle/scores` | the low score screen |

Authentication is `Authorization: Bearer <token>`. The token is the secret; the player id is
public and appears in every scoreboard, so it cannot also be the credential.

There are no emails, so there is no password reset. Say so where people sign up.

## Tests

    npm test

They run against an in-memory database and a stub bank, so they need neither `public/data/` nor
a network.
