import Command from '../classes/command'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags
} from 'discord.js'
import Monitors from '../utils/monitors'
import Database from '../utils/database'

const PAGE_SIZE = 5

type RoomGroup = {
  roomKey: string
  host: string
  port: number
  channel: string
  monitor?: any
  savedConnections: any[]
  inactive: boolean
}

function roomKeyFromParts (host: string, port: number, channel: string) {
  return `${host.trim()}:${port}|${channel}`
}

function groupRooms (liveMonitors: any[], savedConnections: any[]): RoomGroup[] {
  const map = new Map<string, RoomGroup>()

  for (const monitor of liveMonitors) {
    const host = String(monitor.data.host).trim()
    const port = Number(monitor.data.port)
    const channel = String(monitor.data.channel)
    const roomKey = roomKeyFromParts(host, port, channel)

    map.set(roomKey, {
      roomKey,
      host,
      port,
      channel,
      monitor,
      savedConnections: [],
      inactive: false
    })
  }

  for (const connection of savedConnections) {
    const host = String(connection.host).trim()
    const port = Number(connection.port)
    const channel = String(connection.channel)
    const roomKey = roomKeyFromParts(host, port, channel)

    const existing = map.get(roomKey)

    if (existing) {
      existing.savedConnections.push(connection)
    } else {
      map.set(roomKey, {
        roomKey,
        host,
        port,
        channel,
        savedConnections: [connection],
        inactive: true
      })
    }
  }

  return Array.from(map.values())
}

function statusLabel (status: string) {
  switch (status) {
    case 'online':
      return '🟢 Online'
    case 'offline':
      return '🔴 Offline'
    default:
      return '⚪ Unknown'
  }
}

function roomConnectionLabel (group: RoomGroup) {
  if (group.inactive || !group.monitor) return '🔴 Inactive / Disconnected'

  const state = typeof group.monitor.getConnectionState === 'function'
    ? group.monitor.getConnectionState()
    : 'connected'

  switch (state) {
    case 'connected':
      return '🟢 Connected'
    case 'reconnecting':
      return '🟡 Reconnecting'
    case 'disconnected':
      return '🔴 Disconnected'
    default:
      return '⚪ Unknown'
  }
}

function formatRelativeTime (date?: Date | null) {
  if (!date) return null

  const diffMs = Date.now() - date.getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return null

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`

  const years = Math.floor(days / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

function statusWithLastSeen (monitor: any, playerName: string) {
  const status = monitor.getPlayerStatus(playerName)

  if (status !== 'offline') return statusLabel(status)

  if (typeof monitor.hasPlayerCompleted === 'function' && monitor.hasPlayerCompleted(playerName)) {
    return statusLabel(status)
  }

  const lastSeenAt = typeof monitor.getPlayerLastSeenAt === 'function'
    ? monitor.getPlayerLastSeenAt(playerName)
    : null

  const relative = formatRelativeTime(lastSeenAt)

  return relative
    ? `${statusLabel(status)} (last seen ${relative})`
    : statusLabel(status)
}

function buildPlayerLines (group: RoomGroup) {
  if (group.monitor) {
    const roomPlayers = group.monitor.getAllRoomPlayers()
    const trackedSet = new Set(group.monitor.getTrackedPlayers().map((p: any) => p.player))

    return roomPlayers.map((player: any) => {
      const trackedMarker = trackedSet.has(player.name) ? '📌 ' : ''
      return `• ${trackedMarker}\`${player.name}\` — ${statusWithLastSeen(group.monitor, player.name)}`
    }).join('\n')
  }

  const uniquePlayers = new Map<string, any>()

  for (const connection of group.savedConnections) {
    const player = String(connection.player).trim()
    if (!player) continue
    uniquePlayers.set(player, connection)
  }

  if (uniquePlayers.size === 0) {
    return '• No saved players found.'
  }

  return Array.from(uniquePlayers.values()).map((connection: any) => {
    const game = connection.game ? ` (${connection.game})` : ''
    return `• 📌 \`${connection.player}\`${game} — ⚪ Saved only`
  }).join('\n')
}

export async function buildConnectionsView (guildId: string, page: number = 0) {
  const liveMonitors = Monitors.get(guildId)
  const savedConnections = await Database.getConnections()
  const grouped = groupRooms(liveMonitors, savedConnections)

  const total = grouped.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)

  if (total === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('Connections')
          .setDescription('No active or saved monitors.')
      ],
      components: []
    }
  }

  const start = safePage * PAGE_SIZE
  const pageItems = grouped.slice(start, start + PAGE_SIZE)

  const embed = new EmbedBuilder()
    .setTitle('Connections')
    .setDescription(
      pageItems.map((group, index) => {
        const uri = `${group.host}:${group.port}`
        const absoluteIndex = start + index + 1

        const roomPlayers = group.monitor?.getAllRoomPlayers?.() ?? []
        const onlineCount = group.monitor
          ? roomPlayers.filter((p: any) => group.monitor.getPlayerStatus(p.name) === 'online').length
          : 0

        const totalPlayers = group.monitor
          ? roomPlayers.length
          : new Set(group.savedConnections.map((c: any) => String(c.player).trim()).filter(Boolean)).size

        return [
          `**#${absoluteIndex} — \`${uri}\`**`,
          `Room Status: **${roomConnectionLabel(group)}**`,
          group.inactive ? `Saved Rows: **${group.savedConnections.length}**` : `Summary: **${onlineCount}/${totalPlayers} online**`,
          `Player Status:\n${buildPlayerLines(group)}`,
          `Channel: <#${group.channel}>`
        ].join('\n')
      }).join('\n\n')
    )
    .setFooter({ text: `Page ${safePage + 1} of ${totalPages}` })

  const removeRow = new ActionRowBuilder<ButtonBuilder>()
  const reconnectRow = new ActionRowBuilder<ButtonBuilder>()

  for (const group of pageItems) {
    removeRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`connections_remove_room:${encodeURIComponent(group.roomKey)}:${safePage}`)
        .setLabel(`❌ ${group.port}`)
        .setStyle(ButtonStyle.Danger)
    )

    const canReconnect = group.inactive || (
      typeof group.monitor?.canManualReconnect === 'function'
        ? group.monitor.canManualReconnect()
        : false
    )

    reconnectRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`connections_reconnect_room:${encodeURIComponent(group.roomKey)}:${safePage}`)
        .setLabel(`🔄 ${group.port}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canReconnect)
    )
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`connections_prev:${safePage}`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`connections_next:${safePage}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1)
  )

  return {
    embeds: [embed],
    components: [removeRow, reconnectRow, navRow]
  }
}

export default class ConnectionsCommand extends Command {
  name = 'connections'
  description = 'Show active and saved Archipelago connections.'

  constructor (client: any) {
    super()
    this.client = client
  }

  async execute (interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'Server only command.',
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    await interaction.reply(await buildConnectionsView(interaction.guildId, 0))
  }
}