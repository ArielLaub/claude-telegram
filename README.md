# Claudine

**Chat with Claude from your phone via Telegram.**

Claudine turns any Linux or macOS machine into a personal AI coding assistant you can message from anywhere. It's like having Claude Code in your pocket.

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
- **Switch models** - Use Sonnet, Opus, or Haiku depending on the task

All from your phone, anywhere you have internet.

## Quick Setup

### Requirements

| Requirement | Why |
|-------------|-----|
| **Linux or macOS** | Any machine running 24/7 (VPS, home server, Mac mini, etc.) |
| **Node.js 18+** | Run `node --version` to check |
| **Claude subscription** | Max or Pro plan with CLI access |
| **Telegram** | Free app |

### Step 1: Create a Telegram Bot

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**
2. Send `/newbot`
3. Pick a name and username
4. **Copy the token** - looks like `123456789:ABCdefGHIjklMNO...`

### Step 2: Get Your Chat ID

1. Message **[@userinfobot](https://t.me/userinfobot)** on Telegram
2. **Copy the number** it sends back (e.g., `1234567890`)

This ID ensures only YOU can use your bot.

### Step 3: Set Up Claude CLI

```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-code

# Login (opens browser)
claude
```

Follow the prompts to authenticate.

### Step 4: Install Claudine

```bash
# Clone and enter directory
git clone git@github.com:ArielLaub/claude-telegram.git
cd claude-telegram

# Install dependencies
npm install

# Create your config file
cp .env.example .env
```

### Step 5: Configure

Edit `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...   # From Step 1
TELEGRAM_CHAT_IDS=1234567890                 # From Step 2
WORKING_DIR=/home/youruser/projects          # Where Claude can work
```

### Step 6: Run It

```bash
npm start
```

Open Telegram and message your bot to test it.

## Running as a Service

### Linux (systemd)

To run Claudine 24/7, create a systemd service:

```bash
sudo nano /etc/systemd/system/claudine.service
```

Paste this (adjust paths for your system):

```ini
[Unit]
Description=Claudine Telegram Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/claude-telegram
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable claudine
sudo systemctl start claudine

# Check status
sudo systemctl status claudine

# View logs
journalctl -u claudine -f
```

### macOS (launchd)

To run Claudine 24/7 on macOS, create a LaunchAgent. Replace `youruser` and the paths to match your setup, and make sure `npm` resolves on your `PATH` (Homebrew on Apple Silicon installs to `/opt/homebrew/bin`):

```bash
nano ~/Library/LaunchAgents/com.claudine.bot.plist
```

Paste this:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudine.bot</string>

  <key>WorkingDirectory</key>
  <string>/Users/youruser/Development/claude-telegram</string>

  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/npm</string>
    <string>start</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/youruser/Library/Logs/claudine.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/youruser/Library/Logs/claudine.err.log</string>
</dict>
</plist>
```

Load and start:

```bash
launchctl load ~/Library/LaunchAgents/com.claudine.bot.plist

# Check status
launchctl list | grep claudine

# View logs
tail -f ~/Library/Logs/claudine.log

# Stop / reload after edits
launchctl unload ~/Library/LaunchAgents/com.claudine.bot.plist
```

> Note: a LaunchAgent runs while you're logged in. If you want the bot to keep running with the lid closed or after a reboot without login, either install it as a LaunchDaemon under `/Library/LaunchDaemons/` (requires `sudo`) or enable "Automatic login" + caffeinate.

## Commands

### Session

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/sessions` | List and resume recent sessions |
| `/resume` | Resume the most recent session |
| `/name <name>` | Name the current session |
| `/status` | Show current session info |
| `/clear` | Clear all session history |

### Mode

| Command | Description |
|---------|-------------|
| `/plan` | Enter plan mode (Claude explores without making changes) |
| `/approve` | Approve and execute the plan |
| `/cancel` | Cancel plan mode |
| `/stop` | Stop current operation and clear queue |
| `/model` | Change Claude model (Sonnet/Opus/Haiku) |

### System

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/stats` | Show system stats (CPU, memory, temp) |
| `/usage` | Show Claude API usage limits |
| `/verbose <level>` | Set verbosity: `low`, `normal`, or `high` |
| `/restart` | Restart the bot |

## Tool Approval

When Claude wants to run a command or edit a file, you'll see buttons:

- **Allow** - Run this one command
- **Allow All** - Trust this tool for the rest of the session
- **Deny** - Block this action

This keeps you in control of what happens on your server.

## Multiple Users

Add more chat IDs to allow others to use the bot:

```bash
TELEGRAM_CHAT_IDS=123456789,987654321,555555555
```

Each user gets their own separate conversation history and sessions.

## Troubleshooting

### Bot not responding

1. Check it's running: `sudo systemctl status claudine`
2. Check logs: `journalctl -u claudine -f`
3. Make sure your chat ID is in `.env`

### Claude CLI not authenticated

Run `claude` in your terminal and log in again. The bot uses the same auth.

### Permission denied errors

Make sure your `WORKING_DIR` exists and is writable:

```bash
mkdir -p /home/youruser/projects
chmod 755 /home/youruser/projects
```

## Architecture

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

MIT

---

**Built with [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)**
