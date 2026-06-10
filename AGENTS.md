# QuicProxy Workspace Notes

## Project Layout

- `QuicProxy/`: Rust proxy core. API implementation is in `QuicProxy/src/api/mod.rs`.
- `quicboard/`: React/Vite UI for QuicProxy. Main UI is `quicboard/src/App.tsx`.
- `premium/`: existing premium/mobile code, including the Flutter UI.

## Quicboard

The active QuicProxy web UI is `quicboard`.

Useful commands:

```bash
cd quicboard
npm run dev -- --host 0.0.0.0
npm run build
```

The Vite dev server runs on `http://localhost:5173/`.

## QuicProxy API

Quicboard currently uses these core endpoints:

- `GET /observe`: inbounds/outbounds stats, DNS latency, route latency, memory usage.
- `GET /outbounds`: outbound list, selector children, selected node, trace metadata.
- `PUT /selector`: change selector node.
- `GET /mode`, `PUT /mode`: read/change router mode. API values are lowercase: `rule`, `proxy`, `direct`.
- `GET /connections`, `DELETE /connections`: list and close active connections.
- `GET /traffic`: drain destination traffic sample.
- `GET /trace`: trace an outbound.
- `GET /request`: test a URL through an outbound.
- `GET /quit`: stop the core.

Auth uses the `Authorization` header. Quicboard sends `Bearer <password>` when a password is configured.

## UI Behavior Notes

- Router mode is displayed as `Rule`, `Proxy`, `Direct`, but API payloads remain lowercase.
- Realtime network rate is computed client-side from inbound traffic deltas:
  - download rate = `(current download - previous download) / elapsed seconds`
  - upload rate = `(current upload - previous upload) / elapsed seconds`
- Total transfer uses inbound stats to avoid double-counting selector and selected outbound traffic.
- DNS, route, and outbound latency are rendered with colored quality badges.
- Refresh interval is configured in Settings, persisted as `quicproxy.refreshIntervalMs`, and clamped between 1 and 60 seconds.
- Dark/bright mode is controlled by `document.documentElement.dataset.theme` and persisted in `localStorage` as `quicproxy.theme`.

## Build Checks

For Quicboard-only changes, run:

```bash
cd quicboard
npm run build
```

For Rust API/core changes, run the relevant Cargo checks from `QuicProxy/`.

```bash
cd QuicProxy
cargo check
```

## Editing Guidance

- Prefer keeping Quicboard changes scoped to `quicboard/src/App.tsx`, `quicboard/src/lib/*`, and `quicboard/src/styles/main.css`.
- Do not edit generated directories such as `quicboard/dist` or `quicboard/node_modules`.
- If adding a new Quicboard API call, update `quicboard/src/lib/api.ts`.
- If adding a new Rust API endpoint, keep the auth behavior consistent with existing handlers in `QuicProxy/src/api/mod.rs`.
