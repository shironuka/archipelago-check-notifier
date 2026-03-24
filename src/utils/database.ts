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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS connections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      host VARCHAR(255),
      port INT,
      game VARCHAR(255),
      player VARCHAR(255),
      channel VARCHAR(255)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(255),
      user_id VARCHAR(255),
      action VARCHAR(255),
      timestamp DATETIME
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_links (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(255),
      archipelago_name VARCHAR(255),
      discord_id VARCHAR(255),
      UNIQUE KEY (guild_id, archipelago_name)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS presence_status (
      room_key VARCHAR(255) NOT NULL,
      host VARCHAR(255) NOT NULL,
      port INT NOT NULL,
      channel VARCHAR(255) NOT NULL,
      player_name VARCHAR(255) NOT NULL,
      game VARCHAR(255) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'unknown',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (room_key, player_name)
    )
  `)

  // ===== connections table migrations =====
  const [connectionColumns]: any = await pool.query('SHOW COLUMNS FROM connections')
  const connectionColumnNames = connectionColumns.map((c: any) => c.Field)

  if (!connectionColumnNames.includes('mention_join_leave')) {
    await pool.query('ALTER TABLE connections ADD COLUMN mention_join_leave TINYINT(1) DEFAULT 0')
  }
  if (!connectionColumnNames.includes('mention_item_finder')) {
    await pool.query('ALTER TABLE connections ADD COLUMN mention_item_finder TINYINT(1) DEFAULT 1')
  }
  if (!connectionColumnNames.includes('mention_item_receiver')) {
    await pool.query('ALTER TABLE connections ADD COLUMN mention_item_receiver TINYINT(1) DEFAULT 1')
  }
  if (!connectionColumnNames.includes('mention_completion')) {
    await pool.query('ALTER TABLE connections ADD COLUMN mention_completion TINYINT(1) DEFAULT 1')
  }
  if (!connectionColumnNames.includes('mention_hints')) {
    await pool.query('ALTER TABLE connections ADD COLUMN mention_hints TINYINT(1) DEFAULT 1')
  }

  // ===== user_links table migrations =====
  const [linkColumns]: any = await pool.query('SHOW COLUMNS FROM user_links')
  const linkColumnNames = linkColumns.map((c: any) => c.Field)

  if (!linkColumnNames.includes('mention_join_leave')) {
    await pool.query('ALTER TABLE user_links ADD COLUMN mention_join_leave TINYINT(1) DEFAULT 0')
  }
  if (!linkColumnNames.includes('mention_item_finder')) {
    await pool.query('ALTER TABLE user_links ADD COLUMN mention_item_finder TINYINT(1) DEFAULT 1')
  }
  if (!linkColumnNames.includes('mention_item_receiver')) {
    await pool.query('ALTER TABLE user_links ADD COLUMN mention_item_receiver TINYINT(1) DEFAULT 1')
  }
  if (!linkColumnNames.includes('mention_completion')) {
    await pool.query('ALTER TABLE user_links ADD COLUMN mention_completion TINYINT(1) DEFAULT 1')
  }
  if (!linkColumnNames.includes('mention_hints')) {
    await pool.query('ALTER TABLE user_links ADD COLUMN mention_hints TINYINT(1) DEFAULT 1')
  }
  if (!linkColumnNames.includes('embed_color')) {
    await pool.query('ALTER TABLE user_links ADD COLUMN embed_color VARCHAR(16) NULL')
  }
}

async function linkUser (
  guildId: string,
  archipelagoName: string,
  discordId: string,
  flags?: {
    mention_join_leave?: boolean,
    mention_item_finder?: boolean,
    mention_item_receiver?: boolean,
    mention_completion?: boolean,
    mention_hints?: boolean
  },
  embedColor?: string
) {
  const query = `
    INSERT INTO user_links (
      guild_id,
      archipelago_name,
      discord_id,
      mention_join_leave,
      mention_item_finder,
      mention_item_receiver,
      mention_completion,
      mention_hints,
      embed_color
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      discord_id = VALUES(discord_id),
      mention_join_leave = VALUES(mention_join_leave),
      mention_item_finder = VALUES(mention_item_finder),
      mention_item_receiver = VALUES(mention_item_receiver),
      mention_completion = VALUES(mention_completion),
      mention_hints = VALUES(mention_hints),
      embed_color = VALUES(embed_color)
  `

  await pool.query(query, [
    guildId,
    archipelagoName,
    discordId,
    flags?.mention_join_leave ?? false,
    flags?.mention_item_finder ?? true,
    flags?.mention_item_receiver ?? true,
    flags?.mention_completion ?? true,
    flags?.mention_hints ?? true,
    embedColor ?? null
  ])
}

async function unlinkUser (guildId: string, archipelagoName: string) {
  await pool.query(
    'DELETE FROM user_links WHERE guild_id = ? AND archipelago_name = ?',
    [guildId, archipelagoName]
  )
}

async function getLinks (guildId: string): Promise<any[]> {
  const [rows] = await pool.query(
    'SELECT * FROM user_links WHERE guild_id = ?',
    [guildId]
  )

  return (rows as any[]).map(row => ({
    ...row,
    mention_join_leave: !!row.mention_join_leave,
    mention_item_finder: !!row.mention_item_finder,
    mention_item_receiver: !!row.mention_item_receiver,
    mention_completion: !!row.mention_completion,
    mention_hints: !!row.mention_hints,
    embed_color: row.embed_color ?? null
  }))
}

async function createLog (guildId: string, userId: string, action: string) {
  try {
    await pool.query(
      'INSERT INTO activity_log (guild_id, user_id, action, timestamp) VALUES (?, ?, ?, NOW())',
      [guildId, userId, action]
    )
  } catch (err) {
    console.error('Failed to create log:', err)
  }
}

async function getConnections (): Promise<Connection[]> {
  const [rows] = await pool.query('SELECT * FROM connections')

  return (rows as any[]).map(row => ({
    ...row,
    mention_join_leave: !!row.mention_join_leave,
    mention_item_finder: !!row.mention_item_finder,
    mention_item_receiver: !!row.mention_item_receiver,
    mention_completion: !!row.mention_completion,
    mention_hints: !!row.mention_hints
  }))
}

async function getConnection (id: number): Promise<Connection | null> {
  const [rows] = await pool.query(
    'SELECT * FROM connections WHERE id = ?',
    [id]
  )

  const connections = (rows as any[]).map(row => ({
    ...row,
    mention_join_leave: !!row.mention_join_leave,
    mention_item_finder: !!row.mention_item_finder,
    mention_item_receiver: !!row.mention_item_receiver,
    mention_completion: !!row.mention_completion,
    mention_hints: !!row.mention_hints
  }))

  return connections.length > 0 ? connections[0] : null
}

async function makeConnection (data: MonitorData): Promise<number> {
  const [result]: any = await pool.query(
    `INSERT INTO connections (
      host,
      port,
      game,
      player,
      channel,
      mention_join_leave,
      mention_item_finder,
      mention_item_receiver,
      mention_completion,
      mention_hints
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.host,
      data.port,
      data.game,
      data.player,
      data.channel,
      data.mention_join_leave,
      data.mention_item_finder,
      data.mention_item_receiver,
      data.mention_completion,
      data.mention_hints
    ]
  )

  return result.insertId
}

async function removeConnection (monitor: Monitor) {
  await pool.query(
    'DELETE FROM connections WHERE host = ? AND port = ? AND game = ? AND player = ? AND channel = ?',
    [
      monitor.data.host,
      monitor.data.port,
      monitor.data.game,
      monitor.data.player,
      monitor.channel.id
    ]
  )
}

async function upsertPresence (
  roomKey: string,
  host: string,
  port: number,
  channel: string,
  playerName: string,
  game: string | undefined,
  status: 'online' | 'offline' | 'unknown'
) {
  await pool.query(
    `INSERT INTO presence_status (
      room_key,
      host,
      port,
      channel,
      player_name,
      game,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      game = VALUES(game),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP`,
    [roomKey, host, port, channel, playerName, game ?? null, status]
  )
}

async function getPresenceForRoom (roomKey: string): Promise<any[]> {
  const [rows] = await pool.query(
    `SELECT room_key, host, port, channel, player_name, game, status, updated_at
     FROM presence_status
     WHERE room_key = ?`,
    [roomKey]
  )

  return rows as any[]
}

async function deletePresenceForRoom (roomKey: string) {
  await pool.query(
    'DELETE FROM presence_status WHERE room_key = ?',
    [roomKey]
  )
}

const Database = {
  getConnections,
  getConnection,
  makeConnection,
  removeConnection,
  createLog,
  migrate,
  linkUser,
  unlinkUser,
  getLinks,
  upsertPresence,
  getPresenceForRoom,
  deletePresenceForRoom
}

export default Database