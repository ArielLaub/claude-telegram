# Claudine

**Chat with Claude from your phone via Telegram.**

Claudine turns a Raspberry Pi (or any Linux server) into a personal AI coding assistant you can message from anywhere. It's like having Claude Code in your pocket.

![Telegram](https://img.shields.io/badge/Telegram-Bot-blue?logo=telegram)
![Claude](https://img.shields.io/badge/Claude-Sonnet%204-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

## What Can It Do?

- **Read & write code** - Edit files, create projects, refactor code
- **Run commands** - Execute shell commands (with your approval)
- **Search the web** - Look up documentation, APIs, solutions
- **Plan before acting** - Review what Claude wants to do before it does it
- **Resume conversations** - Pick up where you left off

All from your phone, anywhere you have internet.

## 5-Minute Setup

### What You'll Need

| Requirement | Why |
|-------------|-----|
| **A server** | Raspberry Pi, VPS, old laptop - anything running Linux 24/7 |
| **Node.js 18+** | Run `node --version` to check |
| **Claude subscription** | Max or Pro plan with CLI access |
| **Telegram** | Free app, you probably have it |

### Step 1: Create a Telegram Bot (2 min)

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**
2. Send `/newbot`
3. Pick a name (e.g., "My Claude Bot")
4. Pick a username (e.g., "my_claude_bot")
5. **Copy the token** - looks like `123456789:ABCdefGHIjklMNO...`

### Step 2: Get Your Chat ID (1 min)

1. Message **[@userinfobot](https://t.me/userinfobot)** on Telegram
2. **Copy the number** it sends back (e.g., `1234567890`)

This ID ensures only YOU can use your bot.

### Step 3: Set Up Claude CLI (1 min)

```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-code

# Login (opens browser)
claude
```

Follow the prompts to authenticate.

### Step 4: Install Claudine (1 min)

```bash
# Clone and enter directory
git clone https://github.com/ariel-frischer/claudine-telegram.git
cd claudine-telegram

# Install dependencies
npm install

# Create your config file
cp .env.example .env
```

### Step 5: Add Your Tokens

Edit `.env` with nano, vim, or any editor:

```bash
nano .env
```

Fill in your values:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...   # From Step 1
TELEGRAM_CHAT_IDS=1234567890                 # From Step 2
WORKING_DIR=/home/pi/projects                # Where Claude can work
```

### Step 6: Run It

```bash
# Start the bot
npm start
```

**That's it!** Open Telegram and message your bot. Say "Hello" to test it.

## Keeping It Running Forever

Want the bot to start automatically and run 24/7? Create a systemd service:

```bash
sudo nano /etc/systemd/system/claudine.service
```

Paste this (change `pi` and paths to match your setup):

```ini
[Unit]
Description=Claudine Telegram Bot
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/claudine-telegram
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable claudine
sudo systemctl start claudine

# Check it's running
sudo systemctl status claudine

# View logs
journalctl -u claudine -f
```

## Bot Commands

| Command | What it does |
|---------|--------------|
| `/new` | Start a fresh conversation |
| `/sessions` | Browse past conversations |
| `/resume` | Continue last conversation |
| `/plan` | Make Claude plan before acting |
| `/approve` | Execute the plan |
| `/stop` | Stop current operation |
| `/stats` | Show CPU/memory usage |
| `/help` | List all commands |

## How Tool Approval Works

When Claude wants to run a command or edit a file, you'll see buttons:

- **Allow** - Run this one command
- **Allow All** - Trust this tool for the rest of the session
- **Deny** - Block this action

This keeps you in control of what happens on your server.

## Adding More Users

Want to let friends use your bot? Add their chat IDs:

```bash
TELEGRAM_CHAT_IDS=123456789,987654321,555555555
```

Each person gets their own separate conversation history.

## Troubleshooting

### "Bot not responding"

1. Check it's running: `sudo systemctl status claudine`
2. Check logs: `journalctl -u claudine -f`
3. Make sure your chat ID is in `.env`

### "Claude CLI not authenticated"

Run `claude` in your terminal and log in again. The bot uses the same auth.

### "Permission denied" errors

Make sure your `WORKING_DIR` exists and is writable:

```bash
mkdir -p /home/pi/projects
chmod 755 /home/pi/projects
```

## Technical Notes

### Why PreToolUse Hooks?

The Claude Agent SDK's `canUseTool` callback has a [known bug](https://github.com/anthropics/claude-agent-sdk-typescript/issues/29) where it gets bypassed. We use `PreToolUse` hooks instead, which reliably intercept all tool usage.

### Architecture

```
src/
├── index.ts      # Entry point
├── claude.ts     # Claude SDK integration
├── commands.ts   # Slash command handlers
├── session.ts    # Conversation storage
├── queue.ts      # Message batching
└── ui.ts         # Telegram formatting
```

## License

MIT - do whatever you want with it.

---

**Built with [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)**
