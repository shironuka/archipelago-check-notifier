import Command from '../classes/command'
import {
  ApplicationCommandOption,
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder
} from 'discord.js'
import Database from '../utils/database'

const DEFAULT_LINKS_COLOR = 0x0099FF

function parseHexColor (raw?: string | null): number | null {
  if (!raw) return null
  const normalized = raw.replace(/^#/, '').trim()
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return null
  return parseInt(normalized, 16)
}

function boolIcon (value: boolean) {
  return value ? '✅' : '❌'
}

export default class LinksCommand extends Command {
  name = 'links'
  description = 'Show all linked Archipelago players in this server.'

  options: ApplicationCommandOption[] = []

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

    try {
      const links = await Database.getLinks(interaction.guildId)

      if (links.length === 0) {
        await interaction.reply({
          content: 'No players are currently linked in this server.',
          flags: [MessageFlags.Ephemeral]
        })
        return
      }

      const firstValidColor =
        links.map((link: any) => parseHexColor(link.embed_color)).find((c: number | null) => c != null) ?? DEFAULT_LINKS_COLOR

      const embed = new EmbedBuilder()
        .setTitle('Linked Archipelago Players')
        .setDescription('Current player-to-user mappings and notification preferences.')
        .setColor(firstValidColor)

      for (const link of links) {
        const colorText = link.embed_color ? `#${String(link.embed_color).replace(/^#/, '').toUpperCase()}` : 'Default'
        embed.addFields({
          name: `${link.archipelago_name}`,
          value: [
            `User: <@${link.discord_id}>`,
            `Embed Color: \`${colorText}\``,
            `Join/Leave: ${boolIcon(!!link.mention_join_leave)}`,
            `Item Finder: ${boolIcon(!!link.mention_item_finder)}`,
            `Item Receiver: ${boolIcon(!!link.mention_item_receiver)}`,
            `Completion: ${boolIcon(!!link.mention_completion)}`,
            `Hints: ${boolIcon(!!link.mention_hints)}`
          ].join('\n'),
          inline: false
        })
      }

      await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
      })
    } catch (err) {
      console.error('Failed to get links:', err)
      await interaction.reply({
        content: 'Failed to retrieve links from database.',
        flags: [MessageFlags.Ephemeral]
      })
    }
  }
}