# Archipelago Check Notifier - Railway Deployment Guide

A Discord bot that monitors Archipelago multiworld randomizer sessions and posts notifications to Discord channels when checks are found.

## Overview

This bot connects to Archipelago multiworld servers and notifies a Discord channel whenever a player finds a check. It's useful for collaborative gaming sessions where players want to track progress across multiple games.

**Original Repository:** [matthe815s-projects/archipelago-check-notifier](https://github.com/matthe815s-projects/archipelago-check-notifier)

---

## Prerequisites

- A [Discord account](https://discord.com) with a server you can add bots to
- A [Railway account](https://railway.app) (free tier works)
- A [GitHub account](https://github.com) to fork the repository

---

## Setup Instructions

### 1. Fork the Repository

1. Go to the original repository on GitHub
2. Click **Fork** to create your own copy
3. Clone or open your fork in an IDE (WebStorm recommended for TypeScript projects)

---

### 2. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name
3. Go to the **Bot** tab:
    - Click **Reset Token** and copy the token (save it securely - you'll need it later)
    - Under **Privileged Gateway Intents**, enable **Message Content Intent**
4. Go to **OAuth2 → URL Generator**:
    - Select scopes: `bot` and `applications.commands`
    - Select bot permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
5. Copy the generated URL and open it in your browser to invite the bot to your server

---

### 3. Get Your Discord Server ID

1. In Discord, go to **User Settings → Advanced**
2. Enable **Developer Mode**
3. Right-click your server name in the sidebar
4. Click **Copy Server ID**

---

### 4. Deploy to Railway

#### Create the Project

1. Log in to [Railway](https://railway.app)
2. Click **New Project → Deploy from GitHub repo**
3. Select your forked repository
4. Railway will auto-detect it as a Node.js project

#### Add a MySQL Database

1. In your Railway project, click **New → Database → MySQL**
2. Railway will automatically create the database and generate connection variables

#### Configure Environment Variables

In Railway, go to your bot service and add these variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `DISCORD_TOKEN` | Your bot token | From Discord Developer Portal |
| `GUILD_ID` | Your server ID | The ID you copied in step 3 |
| `LOG_CHANNEL` | Channel ID (optional) | Right-click a channel → Copy Channel ID |
| `MYSQLHOST` | `${{MySQL.MYSQLHOST}}` | Reference to database |
| `MYSQLUSER` | `${{MySQL.MYSQLUSER}}` | Reference to database |
| `MYSQLPASSWORD` | `${{MySQL.MYSQLPASSWORD}}` | Reference to database |
| `MYSQLDATABASE` | `${{MySQL.MYSQLDATABASE}}` | Reference to database |

> **Note:** The `${{MySQL.VARIABLENAME}}` syntax links to your Railway MySQL database automatically.

---

## Required Code Modifications

If you're starting from a fresh fork, you'll need to make these changes:

### 1. Update `tsconfig.json`

The original config uses ES5 which is incompatible with modern Discord.js:

```json
{
  "compilerOptions": {
    "lib": ["ES2020"],
    "target": "ES2020",
    "module": "commonjs",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "alwaysStrict": true,
    "noImplicitAny": false,
    "noEmitOnError": false,
    "outDir": "./dist"
  },
  "include": [
    "index.ts",
    "src/**/*"
  ]
}
```

### 2. Update `package.json`

Change the mysql package and simplify build scripts:

```json
{
  "scripts": {
    "build": "tsc || true",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "mysql2": "^3.6.0"
  }
}
```

> **Note:** Remove the old `"mysql": "^2.18.1"` dependency and replace with `mysql2`.

### 3. Update `index.ts`

Replace config file references with environment variables:

```typescript
// Remove this:
// const CONFIG = require('./config/config.json')

// Change login to:
client.login(process.env.DISCORD_TOKEN)

// Change log channel reference to:
process.env.LOG_CHANNEL
```

**Important:** Find any hardcoded guild ID (like `606926504424767488`) and replace with:
```typescript
process.env.GUILD_ID
```

### 4. Update `src/utils/database.ts`

Replace the entire file to use mysql2/promise:

```typescript
import mysql from 'mysql2/promise'
import Monitor from '../classes/monitor'
import { Connection } from '../classes/connection'
import MonitorData from '../classes/monitordata'

const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
})

async function migrate (): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS connections (id INT AUTO_INCREMENT PRIMARY KEY, host VARCHAR(255), port INT, game VARCHAR(255), player VARCHAR(255), channel VARCHAR(255))')
  await pool.query('CREATE TABLE IF NOT EXISTS activity_log (id INT AUTO_INCREMENT PRIMARY KEY, guild_id VARCHAR(255), user_id VARCHAR(255), action VARCHAR(255), timestamp DATETIME)')
}

async function createLog (guildId: string, userId: string, action: string) {
  await pool.query('INSERT INTO activity_log (guild_id, user_id, action, timestamp) VALUES (?, ?, ?, NOW())', [guildId, userId, action])
}

async function getConnections (): Promise<Connection[]> {
  const [rows] = await pool.query('SELECT * FROM connections')
  return rows as Connection[]
}

async function makeConnection (data: MonitorData): Promise<void> {
  await pool.query('INSERT INTO connections (host, port, game, player, channel) VALUES (?, ?, ?, ?, ?)', [data.host, data.port, data.game, data.player, data.channel])
}

async function removeConnection (monitor: Monitor) {
  await pool.query('DELETE FROM connections WHERE host = ? AND port = ? AND game = ? AND player = ? AND channel = ?', [monitor.data.host, monitor.data.port, monitor.data.game, monitor.data.player, monitor.channel.id])
}

const Database = {
  getConnections,
  makeConnection,
  removeConnection,
  createLog,
  migrate
}

export default Database
```

---

## Troubleshooting

### "Missing Access" Error (50001)

**Cause:** Bot lacks `applications.commands` scope or wrong guild ID.

**Solution:**
1. Re-invite the bot with both `bot` and `applications.commands` scopes
2. Verify `GUILD_ID` environment variable matches your server
3. Check for hardcoded guild IDs in the code

### "Unknown Integration" in Discord

**Cause:** Bot crashed while registering commands.

**Solution:**
1. Check Railway logs for the actual error
2. Usually caused by missing `GUILD_ID` or permission issues
3. Re-invite the bot after fixing the underlying issue

### MySQL Authentication Error

**Cause:** Old `mysql` package doesn't support MySQL 8's `caching_sha2_password`.

**Solution:** Use `mysql2` package instead (see code modifications above).

### "npm ci" Lock File Error

**Cause:** `package-lock.json` is out of sync after dependency changes.

**Solution:** Delete `package-lock.json` from your repository. Railway will generate a fresh one.

### TypeScript Compilation Errors

**Cause:** Original tsconfig targets ES5, incompatible with modern libraries.

**Solution:** Update tsconfig.json to target ES2020 (see code modifications above).

### "IncompatibleVersion" Error

**Cause:** Archipelago server requires a newer protocol version than the client defaults to.

**Solution:** This bot has been updated (v1.1.1+) to default to protocol version 0.5.0, which is compatible with `archipelago.gg` and most modern servers. Ensure you are using the latest version of the bot.

---

## Bot Commands

Once deployed, the bot provides these slash commands:

- `/monitor` - Start monitoring an Archipelago session. Supports optional flags to configure mentions:
    - `mention_join_leave` - @ for join/leave (default: false)
    - `mention_item_finder` - @ for finding items (default: true)
    - `mention_item_receiver` - @ for receiving items (default: true)
    - `mention_completion` - @ for finishing goal (default: true)
    - `mention_hints` - @ for hints (default: true)
- `/unmonitor` - Stop monitoring a session
- `/link` - Link an Archipelago player name to a Discord user. Supports optional flags to override monitor defaults for that user:
    - `mention_join_leave` - @ you for join/leave (default: false)
    - `mention_item_finder` - @ you for finding items (default: true)
    - `mention_item_receiver` - @ you for receiving items (default: true)
    - `mention_completion` - @ you for finishing goal (default: true)
    - `mention_hints` - @ you for hints (default: true)
- `/unlink` - Remove a link
- `/links` - Show all links in the server
- `/refresh` - Disconnect and reconnect an Archipelago monitor.

---

## Architecture

```
├── index.ts              # Main entry point, Discord client setup
├── src/
│   ├── classes/
│   │   ├── monitor.ts    # Archipelago connection monitoring
│   │   ├── connection.ts # Database connection type
│   │   └── monitordata.ts# Monitor data structure
│   ├── commands/
│   │   ├── monitorcommand.ts   # /monitor slash command
│   │   ├── unmonitorcommand.ts # /unmonitor slash command
│   │   ├── linkcommand.ts      # /link slash command
│   │   ├── unlinkcommand.ts    # /unlink slash command
│   │   ├── linkscommand.ts     # /links slash command
│   │   └── refreshcommand.ts   # /refresh slash command
│   └── utils/
│       └── database.ts   # MySQL database operations
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies and scripts
```

---

## License

See the original repository for license information.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a full history of changes.