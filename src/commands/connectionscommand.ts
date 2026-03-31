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

const PAGE_SIZE = 5

function groupByRoom (monitors: any[]) {
  const map = new Map<string, any[]>()

  for (const monitor of monitors) {
    const key = `${monitor.data.host}:${monitor.data.port}|${monitor.data.channel}`
    if (!map.has(key)) {
      map.set(key, [])
    }
    map.get(key)!.push(monitor)
  }

  return Array.from(map.entries())
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

function formatRelativeTime (date?: Date | null) {
  if (!date) return null

  const diffMs = Date.now() - date.getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return null

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days} day${days === 1 ? '' : 's'} ago`
  }

  const months = Math.floor(days / 30)
  if (months < 12) {
    return `${months} month${months === 1 ? '' : 's'} ago`
  }

  const years = Math.floor(days / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

function statusWithLastSeen (monitor: any, playerName: string) {
  const status = monitor.getPlayerStatus(playerName)

  if (status !== 'offline') {
    return statusLabel(status)
  }

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

export function buildConnectionsView (guildId: string, page: number = 0) {
  const monitors = Monitors.get(guildId)
  const grouped = groupByRoom(monitors)

  const total = grouped.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)

  if (total === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('Connections')
          .setDescription('No active monitors.')
      ],
      components: []
    }
  }

  const start = safePage * PAGE_SIZE
  const pageItems = grouped.slice(start, start + PAGE_SIZE)

  const embed = new EmbedBuilder()
    .setTitle('Active Connections')
    .setDescription(
      pageItems.map(([, group], index) => {
        const monitor = group[0]
        const uri = `${monitor.data.host}:${monitor.data.port}`
        const absoluteIndex = start + index + 1

        const roomPlayers = monitor.getAllRoomPlayers()
        const onlineCount = roomPlayers.filter((p: any) => monitor.getPlayerStatus(p.name) === 'online').length

        const trackedSet = new Set(monitor.getTrackedPlayers().map((p: any) => p.player))

        const playerLines = roomPlayers.map((player: any) => {
          const trackedMarker = trackedSet.has(player.name) ? '📌 ' : ''
          return `• ${trackedMarker}\`${player.name}\` — ${statusWithLastSeen(monitor, player.name)}`
        }).join('\n')

        return [
          `**#${absoluteIndex} — \`${uri}\`**`,
          `Summary: **${onlineCount}/${roomPlayers.length} online**`,
          `Player Status:\n${playerLines}`,
          `Channel: <#${monitor.data.channel}>`
        ].join('\n')
      }).join('\n\n')
    )
    .setFooter({ text: `Page ${safePage + 1} of ${totalPages}` })

  const roomButtonsRow = new ActionRowBuilder<ButtonBuilder>()
  for (const [, group] of pageItems) {
    const monitor = group[0]
    const roomKey = `${monitor.data.host.trim()}:${monitor.data.port}|${monitor.data.channel}`

    roomButtonsRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`connections_remove_room:${encodeURIComponent(roomKey)}:${safePage}`)
        .setLabel(`❌ ${monitor.data.port}`)
        .setStyle(ButtonStyle.Danger)
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
    components: [roomButtonsRow, navRow]
  }
}

export default class ConnectionsCommand extends Command {
  name = 'connections'
  description = 'Show active Archipelago connections.'

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

    await interaction.reply(buildConnectionsView(interaction.guildId, 0))
  }
}