# Windows Setup Guide

Complete guide for installing and running the Claude Code Discord Bot on Windows.

> **[Korean version (한국어)](SETUP-WINDOWS.kr.md)** | **[macOS / Linux Setup](../SETUP.md)**

---

## 0. Quick Install (Recommended)

```
git clone https://github.com/chadingTV/claudecode-discord.git
cd claudecode-discord
./install.bat
```

`install.bat` automatically handles:
- Node.js installation (via winget or manual download)
- Claude Code CLI installation
- npm package installation
- Project build (`npm run build`)
- Desktop shortcut creation
- Launches the bot with tray app on completion

After installation, the **system tray app** starts automatically. If `.env` is not configured, the **Settings** window opens for you to enter Discord bot credentials.

> If `better-sqlite3` installation fails, Visual Studio Build Tools are required:
> ```powershell
> winget install Microsoft.VisualStudio.2022.BuildTools
> ```
> Select the "Desktop development with C++" workload after installation.

---

## 0-W. WSL Alternative

If you prefer a Linux environment on Windows, you can use WSL instead.

### Installing WSL

Run PowerShell as **Administrator**:

```powershell
wsl --install
```

Reboot after installation. Ubuntu will be installed automatically.
Open **Ubuntu** from the Start menu to get a Linux terminal.

### Node.js in WSL

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # Verify v22.x.x
```

### Claude Code in WSL

```bash
npm install -g @anthropic-ai/claude-code
claude   # First-time login
```

### Git in WSL

```bash
sudo apt-get install -y git
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

### Notes

- Project paths in WSL use `/home/username/projects/...` format
- Windows filesystem (`/mnt/c/...`) is accessible but slower; use WSL internal paths
- For VSCode, install **Remote - WSL** extension, then run `code .` from WSL

> **Session sharing note:** If you use VSCode natively on Windows (most users), you must run the bot on **Windows Native** as well.
> Running the bot in WSL gives project paths like `/home/...`, which won't match VSCode's `C:\Users\...` paths — so Claude Code sessions from VSCode cannot be resumed from Discord.

> For WSL usage, follow the **[macOS / Linux Setup Guide](../SETUP.md)** instead.

---

## 1. Manual Install (if auto install fails)

### Node.js

Node.js 20 or higher is required.

```
node -v   # v20.x.x or higher
```

If not installed: `winget install OpenJS.NodeJS.LTS` or download from [nodejs.org](https://nodejs.org)

### Claude Code

```
npm install -g @anthropic-ai/claude-code
claude   # First-time login (opens browser)
```

> **Important:** You MUST run `claude` in the terminal and log in before starting the bot.
> To verify: run `claude` — if it starts a conversation immediately, you're logged in.

> Claude Code uses **OAuth authentication**, not an API key.
> No `ANTHROPIC_API_KEY` environment variable is needed.

### Clone and Build

```
git clone https://github.com/chadingTV/claudecode-discord.git
cd claudecode-discord
npm install
npm run build
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

   ![Message Content Intent](message-content-intent.png)

### 2-3. Invite Bot to Server

1. Click **"OAuth2"** in the left menu
2. In **"OAuth2 URL Generator"**:
   - **SCOPES**: Check `bot`, `applications.commands`

   <p align="center">
     <img src="discord-scopes.png" alt="Discord OAuth2 Scopes" width="500">
   </p>

   - **BOT PERMISSIONS**: Check `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands`

   <p align="center">
     <img src="discord-bot-permissions.png" alt="Discord Bot Permissions" width="500">
   </p>

3. Copy the generated URL and paste in your browser
4. Select the server to invite to → **Authorize**

---

## 3. Get Discord Server ID

1. Discord app → **User Settings** (gear icon)
2. **App Settings > Advanced** → Enable **Developer Mode**
3. Right-click server name → **"Copy Server ID"**
   - This is your `DISCORD_GUILD_ID`

   ![Copy Server ID](copy-server-id-en.png)

## 4. Get User ID

1. With Developer Mode enabled
2. Click your profile → **"Copy User ID"**
   - This is your `ALLOWED_USER_IDS`
   - Multiple users: comma-separated: `123456789,987654321`

   ![Copy User ID](copy-user-id-en.png)

---

## 5. Configure Settings

### Option A: GUI Settings (Recommended)

Run `win-start.bat` or double-click the **desktop shortcut**. The tray app launches and opens the **Settings** dialog automatically if `.env` is not configured.

<p align="center">
  <img src="windows-settings.png" alt="Windows Settings Dialog" width="450">
</p>

Fill in the fields:
- **Discord Bot Token** — from step 2-2
- **Discord Guild ID** — from step 3
- **Allowed User IDs** — from step 4
- **Base Project Directory** — parent folder of your projects (use Browse button)
- **Rate Limit Per Minute** — default 10
- **Show Cost** — `true` or `false` (Max plan users: set to `false`)

Click **Save**. The bot starts automatically.

### Option B: Manual .env File

```
copy .env.example .env
notepad .env
```

Edit `.env`:

```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_server_id_here
ALLOWED_USER_IDS=your_user_id_here
BASE_PROJECT_DIR=C:\Users\yourname\projects
RATE_LIMIT_PER_MINUTE=10
SHOW_COST=true
```

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Bot token from step 2-2 | `MTQ3MDc...` |
| `DISCORD_GUILD_ID` | Server ID from step 3 | `1470730378955456578` |
| `ALLOWED_USER_IDS` | User ID from step 4 | `942037337519575091` |
| `BASE_PROJECT_DIR` | Parent directory of your projects | `C:\Users\you\projects` |
| `RATE_LIMIT_PER_MINUTE` | Message rate limit (default 10) | `10` |
| `SHOW_COST` | Show estimated API cost (default true) | `false` |

---

## 6. Run

### Desktop Shortcut (Recommended)

Double-click **"Claude Discord Bot"** on your desktop. This launches the tray app with the control panel.

### Command Line

```
win-start.bat          :: Start (background + tray app + control panel)
win-start.bat --stop   :: Stop
win-start.bat --status :: Check status
win-start.bat --fg     :: Foreground mode (for debugging)
```

---

## 7. System Tray App

The bot runs in the background with a **system tray icon** (bottom-right of taskbar).

### Tray Icon Colors

| Color | Status |
|-------|--------|
| 🟢 Green | Bot is running |
| 🔴 Red | Bot is stopped |
| 🟠 Orange | Setup required (.env not configured) |

### Left-Click: Control Panel

Click the tray icon to open the **Control Panel** window:

- **Start / Stop / Restart** bot
- **Settings** — open GUI settings editor
- **View Log** — open bot.log in Notepad
- **Open Folder** — open bot directory in Explorer
- **Auto Run on Startup** — toggle auto-start on Windows login (via Registry)
- **Update** — one-click update when new version available
- **EN / KR** — switch language (English / Korean, persisted)

### Right-Click: Quick Menu

Right-click the tray icon for a quick context menu with the same controls.

### Auto-Start

Check **"Auto Run on Startup"** in the control panel or right-click menu. The tray app will launch automatically when you log in to Windows (uses Windows Registry `HKCU\Run`).

### Auto-Update

When an update is available, the control panel shows an **"Update Available"** button. Clicking it:

1. Stops the bot (if running)
2. Pulls latest code from git
3. Rebuilds the project
4. Recompiles the tray app (.exe)
5. Restarts everything automatically

---

## 8. Usage

### Register a Project to a Channel

In Discord, go to the desired channel:
```
/register path:my-project-folder
```

**Path resolution:**

| Input type | Example | Resolved path (`BASE_PROJECT_DIR=C:\Users\you\projects`) |
|---|---|---|
| Folder name only | `my-app` | `C:\Users\you\projects\my-app` |
| Relative path | `work\my-app` | `C:\Users\you\projects\work\my-app` |
| Absolute path | `C:\Users\you\other\project` | `C:\Users\you\other\project` (used as-is) |

### Send Messages to Claude

Send a regular message in a registered channel and Claude Code will respond.
Attach images, documents, or code files and Claude can read and analyze them.

### Tool Approval

When Claude requests file edits or command execution, buttons appear:
- **Approve** — Approve this one time
- **Deny** — Reject
- **Auto-approve All** — Auto-approve all future requests in this channel

### Session Management

- `/sessions` — Browse and **Resume** or **Delete** previous sessions
- `/clear-sessions` — Delete all session files for the current project

### All Slash Commands

| Command | Description |
|---------|-------------|
| `/register path:<folder>` | Register a project to this channel |
| `/unregister` | Unregister the project |
| `/status` | Check all project/session statuses |
| `/stop` | Stop the Claude session in this channel |
| `/auto-approve mode:on\|off` | Toggle auto-approval |
| `/sessions` | List sessions to resume or delete |
| `/clear-sessions` | Delete all sessions for the project |

---

## 9. Multi-PC Setup

Create a separate Discord bot for each PC and invite them to the same Discord server.

1. Create a **new bot** per PC in Discord Developer Portal (repeat step 2)
2. Invite each bot to the same Discord server
3. Clone this repo on each PC and configure each PC's bot token
4. Each bot registers projects to different channels via `/register`

---

## 10. Security

- Discord servers are **private** by default (no access without invite link)
- Only users in `ALLOWED_USER_IDS` can interact with the bot
- Never expose your bot token. If compromised, immediately **Reset Token** in Discord Developer Portal
- File attachments: executable files (.exe, .bat, etc.) blocked, 25MB size limit

---

## 11. Troubleshooting

### Bot doesn't respond to messages
- Verify MESSAGE CONTENT INTENT is enabled (step 2-2)
- Check that your ID is in `ALLOWED_USER_IDS`

### Tray app doesn't appear
- Check if `tray\ClaudeBotTray.exe` exists. If not, delete it and run `win-start.bat` again to recompile
- Requires .NET Framework (included in all modern Windows)

### "Unknown interaction" error
- Occurs when bot can't respond within 3 seconds → usually resolves automatically

### Slash commands not showing
- Ensure `applications.commands` scope was checked when inviting the bot
- May take up to 1 hour after bot restart (Discord cache)

### Claude Code issues
- Verify with `claude --version`
- Run `claude` to check login status
- If not logged in, run `claude` to re-authenticate
