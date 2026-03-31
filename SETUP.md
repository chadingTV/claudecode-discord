# macOS / Linux Setup Guide

Complete guide for installing and running the Claude Code Discord Bot on macOS and Linux.

> **[Korean version (한국어)](docs/SETUP.kr.md)** | **[Windows Setup](docs/SETUP-WINDOWS.md)**

---

## 0. Auto Install (Recommended)

After cloning, run the install script to automatically check and install Node.js, Claude Code CLI, and npm packages.

```bash
git clone https://github.com/chadingTV/claudecode-discord.git
cd claudecode-discord
./install.sh
```

The script automatically installs dependencies and builds the project. On **macOS**, it also installs Xcode Command Line Tools (needed for the Swift menu bar app) and accepts the Xcode license — you may be prompted for your password.

If auto install fails, follow the manual installation steps below.

---

## 0-M. Manual Install - Prerequisites

### Node.js

Node.js 20 or higher is required.

```bash
node -v   # v20.x.x or higher
```

If not installed:

- **macOS**: `brew install node` or download from [nodejs.org](https://nodejs.org)
- **Linux**:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```

### Claude Code

This bot requires **Claude Code CLI** to be installed and logged in.

```bash
claude --version   # Verify installation
```

If not installed:

```bash
npm install -g @anthropic-ai/claude-code
```

First-time login:

```bash
claude
# Browser opens for Anthropic account login
# After login, CLI is ready to use
```

> **Important: You MUST run `claude` in the terminal and log in before starting the bot.**
> The bot cannot create Claude Code sessions if you haven't logged in first.
> To verify: run `claude` — if it starts a conversation immediately, you're logged in.

> Claude Code uses **OAuth authentication**, not an API key.
> No `ANTHROPIC_API_KEY` environment variable is needed.

---

## 1. Clone and Install

```bash
git clone git@github.com:chadingTV/claudecode-discord.git
cd claudecode-discord
npm install
```

> For HTTPS clone:
> ```bash
> git clone https://github.com/chadingTV/claudecode-discord.git
> ```

### Verify Build (Optional)

```bash
npm run build   # Check for type errors
```

---

## 2. Create Discord Bot

### 2-1. Create Discord Application

1. Go to https://discord.com/developers/applications
2. Click **"New Application"**
3. Enter a name (e.g., "My Claude Code") → **Create**

### 2-2. Bot Settings

1. Click **"Bot"** in the left menu
2. Click **"Reset Token"** → Copy the token (shown only once!)
   - This is your `DISCORD_BOT_TOKEN`
3. Scroll down to **Privileged Gateway Intents**:
   - Enable **MESSAGE CONTENT INTENT** (required!)
   - Save Changes

   ![Message Content Intent](docs/message-content-intent.png)

### 2-3. Invite Bot to Server

1. Click **"OAuth2"** in the left menu
2. In **"OAuth2 URL Generator"**:
   - **SCOPES**: Check `bot`, `applications.commands`

   <p align="center">
     <img src="docs/discord-scopes.png" alt="Discord OAuth2 Scopes" width="500">
   </p>

   - **BOT PERMISSIONS**: Check `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands`

   <p align="center">
     <img src="docs/discord-bot-permissions.png" alt="Discord Bot Permissions" width="500">
   </p>

3. Copy the generated URL and paste in your browser
4. Select the server to invite to → **Authorize**

---

## 3. Get Discord Server ID

1. Discord app (desktop/mobile) → **User Settings** (gear icon)
2. **App Settings > Advanced** → Enable **Developer Mode**
3. Right-click server name (desktop) or long-press (mobile) → **"Copy Server ID"**
   - This is your `DISCORD_GUILD_ID`

   ![Copy Server ID](docs/copy-server-id-en.png)

## 4. Get User ID

1. With Developer Mode enabled
2. Click your profile → **"Copy User ID"**
   - This is your `ALLOWED_USER_IDS`
   - Multiple users: comma-separated: `123456789,987654321`

   ![Copy User ID](docs/copy-user-id-en.png)

---

## 5. Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_server_id_here
ALLOWED_USER_IDS=your_user_id_here
BASE_PROJECT_DIR=/Users/yourname/projects
RATE_LIMIT_PER_MINUTE=10
SHOW_COST=true
```

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Bot token from step 2-2 | `MTQ3MDc...` |
| `DISCORD_GUILD_ID` | Server ID from step 3 | `1470730378955456578` |
| `ALLOWED_USER_IDS` | User ID from step 4 | `942037337519575091` |
| `BASE_PROJECT_DIR` | Parent directory of your projects | `/Users/you/projects` |
| `RATE_LIMIT_PER_MINUTE` | Message rate limit (default 10) | `10` |
| `SHOW_COST` | Show estimated API cost in results (default true) | `false` |

`BASE_PROJECT_DIR` is the base path when using folder names in `/register`.
Example: If `BASE_PROJECT_DIR=/Users/you/projects`, then `/register my-app` → `/Users/you/projects/my-app`

---

## 6. Run

### macOS (Background + Menu Bar)

```bash
./mac-start.sh          # Start (background + menu bar icon)
./mac-start.sh --stop   # Stop
./mac-start.sh --status # Check status
./mac-start.sh --fg     # Foreground mode (for debugging)
```

<p align="center">
  <img src="docs/mac-tray.png" alt="macOS Control Panel" width="400">
</p>

- **Control Panel GUI**: left-click menu bar icon to open control panel (right-click for dropdown menu)
- **EN / KR language toggle** with persistent preference
- First run opens control panel automatically; prompts GUI settings dialog if `.env` not configured
- Menu bar icon: 🟢 running / 🔴 stopped / ⚙️ setup needed
- **Claude Code usage dashboard**: Session (5hr) / Weekly (7day) / Weekly Sonnet usage shown as color-coded progress bars — auto-refreshes every 5 minutes, cached to `~/.claude/.usage-cache.json`, click to open [claude.ai/settings/usage](https://claude.ai/settings/usage)
- GUI Settings dialog with folder browser — no manual `.env` editing needed:

<p align="center">
  <img src="docs/mac-settings.png" alt="macOS Settings Dialog" width="400">
</p>

- One-click auto-update: pulls code, rebuilds bot and menu bar app
- Auto-restarts on crash, auto-starts on boot (via launchd)

### Linux (Background + System Tray)

```bash
./linux-start.sh          # Start (systemd + tray icon if GUI available)
./linux-start.sh --stop   # Stop
./linux-start.sh --status # Check status
./linux-start.sh --fg     # Foreground mode (for debugging)
```

- **EN / KR language toggle** with persistent preference
- **Control Panel GUI**: left-click tray icon to open GTK3 control panel window (right-click for dropdown menu)
- System tray icon: green (running) / red (stopped) / orange (setup needed)
- **Claude Code usage dashboard**: Session (5hr) / Weekly (7day) / Weekly Sonnet usage shown as color-coded progress bars — auto-refreshes every 5 minutes, cached to `~/.claude/.usage-cache.json`, click to open [claude.ai/settings/usage](https://claude.ai/settings/usage)
- GUI Settings dialog with folder browser (GTK3)
- Auto-restarts on crash, auto-starts on boot (via systemd)
- Tray requires `pip3 install pystray Pillow` (auto-installed on first run)
- Works without GUI (headless server) — tray is skipped automatically

### Development Mode

```bash
npm run dev          # Dev mode (hot reload via tsx)
npm run build        # Production build
npm start            # Run built files
```

---

## 7. Usage

### Register a Project to a Channel

In Discord, go to the desired channel:
```
/register path:my-project-folder
```

**How path resolution works:**

| Input type | Example input | Resolved path (`BASE_PROJECT_DIR=/Users/you/projects`) |
|---|---|---|
| Folder name only | `my-app` | `/Users/you/projects/my-app` |
| Relative path | `work/my-app` | `/Users/you/projects/work/my-app` |
| Absolute path | `/Users/you/other/project` | `/Users/you/other/project` (used as-is) |

> **Tip:** Run `pwd` in your terminal inside the project directory to get the absolute path.

### Send Messages to Claude

Send a regular message in a registered channel and Claude Code will respond.
Attach images, documents, or code files and Claude can read and analyze them.

### In-Progress Controls

- **⏹️ Stop** button on progress messages for instant cancellation
- Sending a new message while busy shows "previous task in progress" notice
- `/stop` slash command also available

### Tool Approval

When Claude requests file edits, creation, or command execution, buttons appear:
- **Approve** — Approve this one time
- **Deny** — Reject
- **Auto-approve All** — Auto-approve all future requests in this channel

### Session Management

- `/sessions` — Browse existing sessions and choose to **Resume** or **Delete**
- `/clear-sessions` — Delete all session files for the current project

### Slash Commands

| Command | Description |
|---------|-------------|
| `/register path:<folder>` | Register a project to this channel |
| `/unregister` | Unregister the project |
| `/status` | Check all project/session statuses |
| `/stop` | Stop the Claude session in this channel |
| `/auto-approve mode:on\|off` | Toggle auto-approval |
| `/sessions` | List sessions to resume or delete |
| `/clear-sessions` | Delete all sessions for the project |
| `/usage` | Show Claude Code usage (Session 5hr / Weekly / Sonnet) |

---

## 8. Multi-PC Setup

Create a separate Discord bot for each PC and invite them to the same Discord server (guild).

1. Create a **new bot** per PC in Discord Developer Portal (repeat step 2)
2. Invite each bot to the same Discord server
3. Clone this repo on each PC and set the PC's bot token in `.env`
4. Each bot registers projects to different channels via `/register`

Multiple bots in the same guild are distinguishable by bot name when running slash commands.

---

## 9. Security

- Discord servers are **private** by default (no access without invite link)
- Only users in `ALLOWED_USER_IDS` can interact with the bot
- Never expose your bot token. If compromised, immediately **Reset Token** in Discord Developer Portal
- File attachments: executable files (.exe, .bat, etc.) blocked, 25MB size limit

---

## 10. Troubleshooting

### Bot doesn't respond to messages
- Verify MESSAGE CONTENT INTENT is enabled (step 2-2)
- Check that your ID is in `ALLOWED_USER_IDS`

### "Unknown interaction" error
- Occurs when bot can't respond within 3 seconds → usually resolves automatically

### Slash commands not showing
- Ensure `applications.commands` scope was checked when inviting the bot
- May take up to 1 hour after bot restart (Discord cache)

### Resuming sessions
- Sessions persist across bot restarts (session ID stored in DB)
- Session records are kept even after `/stop` (auto-resumes on next message)
- Use `/sessions` to browse and resume or delete previous sessions
- Use `/clear-sessions` to delete all sessions at once
- `/unregister` removes the DB session mapping

### Manual update
If the tray update button doesn't work, open a terminal in the bot folder and run:
```bash
git fetch origin main --tags && git reset --hard origin/main && npm install && npm rebuild better-sqlite3 && npm run build
```
Then restart the bot. After this one-time fix, future tray updates will work normally.

### Claude Code issues
- Verify installation with `claude --version`
- Run `claude` to check login status
- If not logged in, run `claude` to re-authenticate
