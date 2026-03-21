import Command from '../classes/command'
import {
  ApplicationCommandOption,
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js'
import MonitorData from '../classes/monitordata'
import Monitors from '../utils/monitors'
import Database from '../utils/database'

export default class MonitorCommand extends Command {
  name = 'monitor'
  description = 'Start tracking an Archipelago session.'

  options: ApplicationCommandOption[] = [
    {
      type: ApplicationCommandOptionType.String,
      name: 'host',
      description: 'The host to connect to',
      required: true,
      autocomplete: true
    },
    {
      type: ApplicationCommandOptionType.Integer,
      name: 'port',
      description: 'The port to use',
      required: true
    },
    {
      type: ApplicationCommandOptionType.String,
      name: 'game',
      description: 'Optional game name',
      required: false
    },
    {
      type: ApplicationCommandOptionType.String,
      name: 'player',
      description: 'The Archipelago slot/player name',
      required: true
    },
    {
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText],
      name: 'channel',
      description: 'The channel to send messages to',
      required: true
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_join_leave',
      description: 'Whether to @ people for joining or leaving (default: false)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_item_finder',
      description: 'Whether to @ people when they find an item (default: true)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_item_receiver',
      description: 'Whether to @ people when they receive an item (default: true)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_completion',
      description: 'Whether to @ people when they complete their goal (default: true)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_hints',
      description: 'Whether to @ people when they are mentioned in a hint (default: true)',
      required: false
    }
  ]

  constructor (client: any) {
    super()
    this.client = client
  }

  validate (interaction: ChatInputCommandInteraction) {
    const host = interaction.options.getString('host', true).trim()

    // allow common domain-style hosts like archipelago.gg or custom domains
    const hostRegex = /^(localhost|(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}))$/
    if (!hostRegex.test(host)) {
      interaction.reply({
        content: 'Invalid host name format.\nPlease use a domain like archipelago.gg or localhost.',
        flags: [MessageFlags.Ephemeral]
      })
      return false
    }

    const channel = interaction.options.getChannel('channel', true)
    if (channel == null) return false
    if (interaction.guild?.channels.cache.get(channel.id) == null) return false

    return true
  }

  execute (interaction: ChatInputCommandInteraction) {
    if (!this.validate(interaction)) return

    const host = interaction.options.getString('host', true).trim()
    const game = interaction.options.getString('game')?.trim()

    const monitorData: MonitorData = {
      host,
      port: interaction.options.getInteger('port', true),
      game: game != null && game.length > 0 ? game : undefined,
      player: interaction.options.getString('player', true).trim(),
      channel: interaction.options.getChannel('channel', true).id,
      mention_join_leave: interaction.options.getBoolean('mention_join_leave') ?? false,
      mention_item_finder: interaction.options.getBoolean('mention_item_finder') ?? true,
      mention_item_receiver: interaction.options.getBoolean('mention_item_receiver') ?? true,
      mention_completion: interaction.options.getBoolean('mention_completion') ?? true,
      mention_hints: interaction.options.getBoolean('mention_hints') ?? true
    }

    const uri = `${monitorData.host}:${monitorData.port}`

    if (Monitors.has(uri)) {
      interaction.reply({
        content: `Already monitoring ${uri}.`,
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    interaction.reply({
      content: `Attempting to monitor ${uri}...`,
      flags: [MessageFlags.Ephemeral]
    }).catch(console.error)

    Monitors.make(monitorData, this.client).then(async (monitor) => {
      monitor.data.id = await Database.makeConnection(monitorData)
      await interaction.followUp({
        content: `Now monitoring ${uri}.`,
        flags: [MessageFlags.Ephemeral]
      }).catch(console.error)
    }).catch(async (err) => {
      console.error('Failed to create monitor:', err)
      await interaction.followUp({
        content: 'Failed to connect to Archipelago. Please check host, port, player, and optional game.',
        flags: [MessageFlags.Ephemeral]
      }).catch(console.error)
    })
  }

  autocomplete (interaction: AutocompleteInteraction): void {
    const focused = interaction.options.getFocused().trim().toLowerCase()

    const suggestions = [
      'archipelago.gg'
    ]

    const filtered = suggestions
      .filter(host => focused.length === 0 || host.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(host => ({
        name: host,
        value: host
      }))

    void interaction.respond(filtered)
  }
}