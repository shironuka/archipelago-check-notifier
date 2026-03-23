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

function groupByConnection (monitors: any[]) {
  const map = new Map<string, any[]>()

  for (const monitor of monitors) {
    const key = `${monitor.data.host}:${monitor.data.port}`

    if (!map.has(key)) {
      map.set(key, [])
    }

    map.get(key)!.push(monitor)
  }

  return Array.from(map.entries())
}

function getPlayerOnlineStatusForGroup (groupMonitors: any[], playerName: string) {
  let sawAnySignal = false

  for (const monitor of groupMonitors) {
    if (typeof monitor.isPlayerOnline === 'function') {
      sawAnySignal = true
      if (monitor.isPlayerOnline(playerName)) {
        return '🟢 Online'
      }
    }
  }

  return sawAnySignal ? '🔴 Offline' : '⚪ Unknown'
}

export function buildConnectionsView (guildId: string, page: number = 0) {
  const monitors = Monitors.get(guildId)
  const grouped = groupByConnection(monitors)

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
      pageItems.map(([uri, groupMonitors], index) => {
        const absoluteIndex = start + index + 1

        const playerLines = groupMonitors.map(monitor => {
          const playerName = monitor.data.player
          const status = getPlayerOnlineStatusForGroup(groupMonitors, playerName)
          return `• \`${playerName}\` — ${status}`
        }).join('\n')

        return [
          `**#${absoluteIndex} — \`${uri}\`**`,
          `Player Status:\n${playerLines}`,
          `Channel: <#${groupMonitors[0].data.channel}>`
        ].join('\n')
      }).join('\n\n')
    )
    .setFooter({ text: `Page ${safePage + 1} of ${totalPages}` })

  const rows: ActionRowBuilder<ButtonBuilder>[] = []

  for (const [, groupMonitors] of pageItems) {
    for (let i = 0; i < groupMonitors.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>()

      for (const monitor of groupMonitors.slice(i, i + 5)) {
        const key = Monitors.getMonitorKey(monitor)

        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`connections_remove:${encodeURIComponent(key)}:${safePage}`)
            .setLabel(`❌ ${monitor.data.player}`)
            .setStyle(ButtonStyle.Danger)
        )
      }

      rows.push(row)
    }
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

  rows.push(navRow)

  return {
    embeds: [embed],
    components: rows
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

    const view = buildConnectionsView(interaction.guildId, 0)

    await interaction.reply({
      ...view,
      flags: [MessageFlags.Ephemeral]
    })
  }
}