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

function buildConnectionsEmbed (guildId: string, page: number) {
  const monitors = Monitors.get(guildId)
  const totalPages = Math.max(1, Math.ceil(monitors.length / PAGE_SIZE))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)
  const start = safePage * PAGE_SIZE
  const pageItems = monitors.slice(start, start + PAGE_SIZE)

  const embed = new EmbedBuilder()
    .setTitle('Active Connections')
    .setFooter({ text: `Page ${safePage + 1} of ${totalPages}` })

  if (pageItems.length === 0) {
    embed.setDescription('No active monitors in this server.')
    return { embed, components: [], totalPages, page: safePage }
  }

  embed.setDescription(
    pageItems.map((m, i) => {
      const index = start + i + 1
      const status = m.isActive
        ? (m.isReconnecting ? 'Reconnecting' : 'Connected')
        : 'Stopped'

      return [
        `**#${index}**`,
        `Host: \`${m.data.host}:${m.data.port}\``,
        `Player: \`${m.data.player}\``,
        `Game: \`${m.data.game ?? 'Unknown'}\``,
        `Channel: <#${m.data.channel}>`,
        `Status: \`${status}\``
      ].join('\n')
    }).join('\n\n')
  )

  const removeRows = pageItems.map((m, i) => {
    const index = start + i + 1
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`connections-remove:${m.data.host}:${m.data.port}`)
        .setLabel(`Remove #${index}`)
        .setStyle(ButtonStyle.Danger)
    )
  })

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`connections-page:${safePage - 1}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`connections-page:${safePage + 1}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1)
  )

  return {
    embed,
    components: [...removeRows, navRow],
    totalPages,
    page: safePage
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

    const { embed, components } = buildConnectionsEmbed(interaction.guildId, 0)

    await interaction.reply({
      embeds: [embed],
      components,
      flags: [MessageFlags.Ephemeral]
    })
  }
}

export { buildConnectionsEmbed }