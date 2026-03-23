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

function getStatus (monitor: any) {
  if (!monitor.isActive) return '🔴 Stopped'
  if (monitor.isReconnecting) return '🟡 Reconnecting'
  return '🟢 Connected'
}

export function buildConnectionsView (guildId: string, page: number = 0) {
  const monitors = Monitors.get(guildId)
  const total = monitors.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)

  if (total === 0) {
    const embed = new EmbedBuilder()
      .setTitle('Connections')
      .setDescription('No active monitors in this server.')

    return {
      embeds: [embed],
      components: []
    }
  }

  const start = safePage * PAGE_SIZE
  const pageItems = monitors.slice(start, start + PAGE_SIZE)

  const embed = new EmbedBuilder()
    .setTitle('Active Connections')
    .setDescription(
      pageItems.map((monitor, index) => {
        const absoluteIndex = start + index + 1
        const uri = `${monitor.data.host}:${monitor.data.port}`

        return [
          `**#${absoluteIndex}**`,
          `Host: \`${uri}\``,
          `Player: \`${monitor.data.player}\``,
          `Game: \`${monitor.data.game ?? 'Unknown'}\``,
          `Channel: <#${monitor.data.channel}>`,
          `Status: ${getStatus(monitor)}`
        ].join('\n')
      }).join('\n\n')
    )
    .setFooter({ text: `Page ${safePage + 1} of ${totalPages} • ${total} active monitor${total === 1 ? '' : 's'}` })

  const removeRows: ActionRowBuilder<ButtonBuilder>[] = []

  for (let i = 0; i < pageItems.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>()

    for (const [offset, monitor] of pageItems.slice(i, i + 5).entries()) {
      const localIndex = i + offset
      const key = Monitors.getMonitorKey(monitor)

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`connections_remove:${encodeURIComponent(key)}:${safePage}`)
          .setLabel(`Remove ${localIndex + 1}`)
          .setStyle(ButtonStyle.Danger)
      )
    }

    removeRows.push(row)
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
    components: [...removeRows, navRow]
  }
}

export default class ConnectionsCommand extends Command {
  name = 'connections'
  description = 'List all active Archipelago monitors in this server.'

  constructor (client: any) {
    super()
    this.client = client
  }

  async execute (interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
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