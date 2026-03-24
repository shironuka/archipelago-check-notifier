import Command from '../classes/command'
import {
  ApplicationCommandOption,
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js'
import Database from '../utils/database'

export default class LinkCommand extends Command {
  name = 'link'
  description = 'Link an Archipelago player name to a Discord user.'

  options: ApplicationCommandOption[] = [
    {
      type: ApplicationCommandOptionType.String,
      name: 'player',
      description: 'The Archipelago player name',
      required: true
    },
    {
      type: ApplicationCommandOptionType.User,
      name: 'user',
      description: 'The Discord user to link (defaults to you)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.String,
      name: 'embed_color',
      description: 'Optional embed color in hex, like FF0000 or 00FFAA',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_join_leave',
      description: 'Whether to @ you for joining or leaving (default: false)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_item_finder',
      description: 'Whether to @ you when you find an item (default: false)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_item_receiver',
      description: 'Whether to @ you when you receive an item (default: true)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_completion',
      description: 'Whether to @ you when you complete your goal (default: true)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_hints',
      description: 'Whether to @ you when you are mentioned in a hint (default: true)',
      required: false
    }
  ]

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

    const player = interaction.options.getString('player', true).trim()
    const user = interaction.options.getUser('user') || interaction.user
    const rawEmbedColor = interaction.options.getString('embed_color')?.trim()

    let embedColor: string | undefined
    if (rawEmbedColor) {
      const normalized = rawEmbedColor.replace(/^#/, '').toUpperCase()

      if (!/^[0-9A-F]{6}$/.test(normalized)) {
        await interaction.reply({
          content: 'Invalid embed_color. Use a 6-digit hex value like `FF0000` or `00FFAA`.',
          flags: [MessageFlags.Ephemeral]
        })
        return
      }

      embedColor = normalized
    }

    const flags = {
      mention_join_leave: interaction.options.getBoolean('mention_join_leave') ?? false,
      mention_item_finder: interaction.options.getBoolean('mention_item_finder') ?? false,
      mention_item_receiver: interaction.options.getBoolean('mention_item_receiver') ?? true,
      mention_completion: interaction.options.getBoolean('mention_completion') ?? true,
      mention_hints: interaction.options.getBoolean('mention_hints') ?? true
    }

    try {
      await Database.linkUser(interaction.guildId, player, user.id, flags, embedColor)

      const colorText = embedColor ? ` Embed color set to \`#${embedColor}\`.` : ''

      await interaction.reply({
        content: `Linked Archipelago player **${player}** to <@${user.id}>.${colorText} Notifications involving this player will now mention them based on the selected flags.`,
        flags: [MessageFlags.Ephemeral]
      })
    } catch (err) {
      console.error('Failed to link user:', err)
      await interaction.reply({
        content: 'Failed to link user in database.',
        flags: [MessageFlags.Ephemeral]
      })
    }
  }
}