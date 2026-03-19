# Agar.io — Multiplayer Server

Real-time multiplayer using **Socket.io**. The server runs the authoritative game loop at 30fps; clients only send input and render what they receive.

## Setup

```bash
npm install
npm start
# → http://localhost:3000
```

Dev mode (auto-restart on changes):
```bash
npm run dev
```

## Play with friends

### Local network
1. Find your IP: `ifconfig` (Mac/Linux) or `ipconfig` (Windows)
2. Friends open `http://<your-ip>:3000`

### Over the internet (no port-forwarding)
```bash
npx ngrok http 3000
# Share the https://xxxx.ngrok.io link
```

## Architecture

```
Client                         Server (authoritative)
──────                         ──────────────────────
mouse pos  ──── socket.io ───► game loop @ 30fps
split/eject ────────────────►  physics, eating, bots
              ◄──────────────  viewport-culled snapshot
render ◄────────────────────
```

## Socket events

| Direction       | Event     | Payload          | Description              |
|----------------|-----------|------------------|--------------------------|
| client → server | `join`   | `{ name }`       | Enter the game           |
| client → server | `input`  | `{ tx, ty }`     | World-space mouse target |
| client → server | `split`  | —                | Split cells              |
| client → server | `eject`  | —                | Eject mass               |
| client → server | `respawn`| `{ name }`       | Respawn after death      |
| server → client | `joined` | `{ id, color }`  | Confirmed join           |
| server → client | `state`  | snapshot         | Game state @ 30fps       |
| server → client | `dead`   | `{ killer }`     | You were eaten           |
