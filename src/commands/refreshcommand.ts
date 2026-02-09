import Command from '../classes/command'
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js'
import Monitors from '../utils/monitors'

export default class RefreshCommand extends Command {
  name = 'refresh'
  description = 'Refresh a monitoring session by disconnecting and reconnecting.'

  constructor (client: any) {
    super()
    this.client = client
  }

  async execute (interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: [MessageFlags.Ephemeral] })
    }

    const monitors = Monitors.get(interaction.guildId)
    if (monitors.length === 0) {
      return interaction.reply({ content: 'No active monitors for this server.', flags: [MessageFlags.Ephemeral] })
    }

    const embed = new EmbedBuilder()
      .setTitle('Active Archipelago Monitors')
      .setDescription('Select a monitor to refresh its connection.')
      .setColor('#0099ff')

    const rows: ActionRowBuilder<ButtonBuilder>[] = []
    let currentRow = new ActionRowBuilder<ButtonBuilder>()

    for (const monitor of monitors) {
      const uri = `${monitor.data.host}:${monitor.data.port}`
      const button = new ButtonBuilder()
        .setCustomId(`remonitor:${monitor.data.id}`)
        .setLabel(`Refresh ${uri}`)
        .setStyle(ButtonStyle.Primary)

      if (currentRow.components.length === 5) {
        rows.push(currentRow)
        currentRow = new ActionRowBuilder<ButtonBuilder>()
      }
      currentRow.addComponents(button)

      embed.addFields({ name: uri, value: `Player: ${monitor.data.player}\nGame: ${monitor.data.game}\nChannel: <#${monitor.data.channel}>` })
    }

    if (currentRow.components.length > 0) {
      rows.push(currentRow)
    }

    interaction.reply({ embeds: [embed], components: rows, flags: [MessageFlags.Ephemeral] })
  }
}
