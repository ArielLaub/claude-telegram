# Claudine

**A Claude-powered Telegram bot that brings [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to your pocket.**

Run Claude as a Telegram bot on a Raspberry Pi (or any server) and get full coding assistance from your phone - file editing, code generation, web search, shell commands, and more.

![Telegram](https://img.shields.io/badge/Telegram-Bot-blue?logo=telegram)
![Claude](https://img.shields.io/badge/Claude-Sonnet%204-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

- **Full Claude Code capabilities** - Read/write files, run commands, search the web
- **Mobile-optimized UI** - Clean formatting with blockquotes, progress indicators
- **Real-time status** - Live updates as Claude reads files, runs commands, thinks
- **Session management** - Resume previous conversations anytime
- **Tool approval** - Control when Claude can execute sensitive operations
- **System monitoring** - CPU/memory histograms over the last 10 minutes
- **Plan mode** - Have Claude plan before making changes
- **Message batching** - Send multiple messages while processing, they'll be combined

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** (or Bun)
- **Claude Max/Pro subscription** with CLI access
- **Telegram account**

### 1. Create Your Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the **bot token** (looks like `123456789:ABCdefGHI...`)

### 2. Get Your Chat ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. Copy your **chat ID** (a number like `1234567890`)

### 3. Login to Claude CLI

```bash
# Install Claude CLI globally
npm install -g @anthropic-ai/claude-code

# Authenticate (opens browser)
claude login
```

### 4. Install Claudine

```bash
# Clone the repo
git clone https://github.com/yourusername/claudine.git
cd claudine

# Install dependencies
npm install

# Copy example environment file
cp .env.example .env
```

### 5. Configure

Edit `.env` with your values:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_IDS=1234567890              # Single user
# TELEGRAM_CHAT_IDS=123,456,789           # Multiple users (comma-separated)
WORKING_DIR=/home/pi/projects             # Optional, defaults to current dir
```

**Multi-user setup:** Add multiple chat IDs separated by commas. Each user gets their own independent session. All users share the same Claude API quota.

### 6. Run

```bash
# Development (with auto-reload)
npm run dev

# Production
npm run build && npm start
```

**Done!** Message your bot on Telegram to start chatting with Claude.

## 📱 Commands

### Session
| Command | Description |
|---------|-------------|
| `/new` | Start fresh conversation |
| `/sessions` | Browse & resume past sessions |
| `/resume` | Resume most recent session |
| `/name <name>` | Name current session |
| `/status` | Show session info |
| `/clear` | Clear all history |

### Modes
| Command | Description |
|---------|-------------|
| `/plan` | Plan mode - Claude explores but doesn't change files |
| `/approve` | Execute the plan |
| `/cancel` | Exit plan mode |
| `/stop` | Stop current operation |

### System
| Command | Description |
|---------|-------------|
| `/stats` | CPU/memory with 10-min histogram |
| `/usage` | Claude API usage & limits |
| `/verbose` | Set output detail level (low/normal/high) |
| `/help` | Show all commands |
| `/restart` | Restart the bot |

### Verbosity Levels

Control how much detail is shown during operations:

| Level | Description |
|-------|-------------|
| `/verbose low` | Minimal - just "Running command", skips read operations |
| `/verbose normal` | Default - file names, brief descriptions |
| `/verbose high` | Detailed - full commands, code diffs, paths |

## 🔒 Security

- **Whitelist-only access** - Only chat IDs in `TELEGRAM_CHAT_IDS` can interact
- **Multi-user support** - Add friends by adding their chat IDs (comma-separated)
- **Tool approval** - Bash commands and file writes need explicit approval
- **Auto-approve option** - "Allow All" to trust a tool for the session
- **No API keys stored** - Uses Claude CLI's OAuth authentication

## 🍓 Running on Raspberry Pi

### As a Systemd Service

Create `/etc/systemd/system/claudine.service`:

```ini
[Unit]
Description=Claudine Telegram Bot
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/claudine
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable claudine
sudo systemctl start claudine

# View logs
journalctl -u claudine -f
```

## 🏗️ Architecture

```
src/
├── index.ts           # Entry point, environment setup
├── bot.ts             # Telegram bot, message routing
├── claude.ts          # Claude SDK integration, tool handling
├── commands.ts        # Slash command handlers
├── ui.ts              # Telegram formatting, keyboards, status messages
├── session.ts         # Conversation persistence
├── queue.ts           # Message batching
├── stats-collector.ts # CPU/memory monitoring
└── types.ts           # TypeScript interfaces
```

### How It Works

1. **Message received** → Telegram webhook/polling
2. **Queued** → Multiple messages batched if sent quickly
3. **Sent to Claude** → Via Agent SDK with tool permissions
4. **Live updates** → Status message shows current action
5. **Tool approval** → Sensitive ops need your OK
6. **Response** → Formatted for mobile, sent to Telegram

## 🛠️ Development

```bash
# Run with hot reload
npm run dev

# Type check
npx tsc --noEmit

# Build for production
npm run build
```

## 📄 License

MIT - see [LICENSE](LICENSE)

## 🙏 Credits

Built with:
- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) by Anthropic
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- TypeScript

---

**Made with Claude** 🤖
