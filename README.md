# ObserveClaw

System observability dashboard for [OpenClaw](https://github.com/openclaw/openclaw).

Real-time monitoring of your OpenClaw gateway — sessions, model usage, tool invocations, network activity, system resources, and more.

![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **System Pulse** — real-time agent state (idle/thinking/building) with live transitions
- **Model Usage** — token counts, costs, and model breakdown across sessions
- **Tool Activity** — tool invocations and completions with timing
- **Network Monitor** — outbound connections, listening ports, and traffic classification
- **System Pressure** — CPU, memory, and storage utilization
- **Event Timeline** — searchable log of all gateway events
- **Session Overview** — active sessions, agents, and channels at a glance
- **Alerting** — configurable rules with Telegram notification support
- **Data Retention** — automatic cleanup policies with cron integration

## Requirements

- **Node.js** >= 22
- **OpenClaw** gateway running (local or remote)

## Quick Start

### Install from GitHub

```bash
npm install -g github:roryhw/observeclaw
```

### Configure

Create a `.env` file in your working directory (or set environment variables):

```bash
# Required — point to your OpenClaw gateway
GATEWAY_URL=ws://127.0.0.1:18789

# Recommended — use your gateway token or password
GATEWAY_TOKEN=your-token-here
# or
GATEWAY_PASSWORD=your-password-here

# Recommended — protect the dashboard
OBSERVECLAW_OPERATOR_PASSWORD=choose-a-password
```

If OpenClaw is running on the same machine with default settings, `GATEWAY_URL` can be omitted (defaults to `ws://127.0.0.1:18789`).

### Run

```bash
observeclaw
```

Open `http://localhost:3001` in your browser.

### Run with Docker (alternative)

```bash
docker build -t observeclaw .
docker run -p 3001:3001 \
  -e GATEWAY_URL=ws://host.docker.internal:18789 \
  -e GATEWAY_TOKEN=your-token \
  observeclaw
```

## Configuration

All configuration is via environment variables. See [`.env.example`](.env.example) for the full list.

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_URL` | `ws://127.0.0.1:18789` | OpenClaw gateway WebSocket URL |
| `GATEWAY_TOKEN` | | Gateway auth token |
| `GATEWAY_PASSWORD` | | Gateway auth password |
| `OBSERVECLAW_PORT` | `3001` | Dashboard HTTP port |
| `OBSERVECLAW_HOST` | `0.0.0.0` | Bind address |
| `OBSERVECLAW_OPERATOR_PASSWORD` | | Dashboard login password |
| `OBSERVECLAW_TELEGRAM_BOT_TOKEN` | | Telegram bot token for alerts |
| `OBSERVECLAW_TELEGRAM_CHAT_ID` | | Telegram chat ID for alerts |
| `OPENCLAW_DIST_DIR` | auto-detected | Override OpenClaw dist directory path |

## Development

```bash
git clone https://github.com/roryhw/observeclaw.git
cd observeclaw
npm install
cd ui && npm install && cd ..

# Development mode (auto-reload)
npm run dev

# Build for production
npm run build

# Start production build
npm start
```

## How It Works

ObserveClaw connects to your OpenClaw gateway via WebSocket and subscribes to the real-time event stream. It also polls session usage data periodically for aggregate statistics.

Events are normalized, stored in a local SQLite database, and served to the browser dashboard via a Fastify HTTP server and WebSocket connection.

**Data stays local.** ObserveClaw stores everything on your machine in a SQLite file — nothing is sent to external services.

## Platform Support

- **macOS** (ARM and Intel)
- **Linux** (x86_64 and ARM)

System metrics (memory, storage, network) use platform-native tools when available (`vm_stat` on macOS, `/proc/meminfo` on Linux, `lsof` or `ss` for network) with cross-platform fallbacks.

## License

MIT
