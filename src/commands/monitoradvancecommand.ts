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

export default class MonitorAdvanceCommand extends Command {
  name = 'monitor-advance'
  description = 'Start tracking an Archipelago session (custom host).'

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
      required: true,
      autocomplete: true
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
      required: true,
      autocomplete: true
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
      description: 'Mention on join/leave (default: false)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_item_finder',
      description: 'Mention item finder (default: true)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_item_receiver',
      description: 'Mention item receiver (default: true)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_completion',
      description: 'Mention goal completion (default: true)',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'mention_hints',
      description: 'Mention hints (default: true)',
      required: false
    }
  ]

  constructor (client: any) {
    super()
    this.client = client
  }

  async autocomplete (interaction: AutocompleteInteraction) {
    if (interaction.guildId == null) {
      await interaction.respond([])
      return
    }

    const focused = interaction.options.getFocused(true)

    if (focused.name === 'host') {
      const typed = String(focused.value ?? '').trim().toLowerCase()
      const choices = new Map<string, { name: string, value: string }>()

      choices.set('archipelago.gg', { name: 'archipelago.gg', value: 'archipelago.gg' })

      for (const monitor of Monitors.get(interaction.guildId)) {
        const host = monitor.data.host?.trim()
        if (host && !choices.has(host.toLowerCase())) {
          choices.set(host.toLowerCase(), { name: host, value: host })
        }
      }

      const results = Array.from(choices.values())
        .filter(choice => typed.length === 0 || choice.name.toLowerCase().includes(typed))
        .slice(0, 25)

      await interaction.respond(results)
      return
    }

    if (focused.name === 'port') {
      const typed = String(focused.value ?? '').trim()
      const selectedHost = interaction.options.getString('host')?.trim().toLowerCase()
      const choices = new Map<number, { name: string, value: number }>()

      for (const monitor of Monitors.get(interaction.guildId)) {
        const host = monitor.data.host?.trim().toLowerCase()
        if (selectedHost && host !== selectedHost) continue

        const port = monitor.data.port
        const labelHost = monitor.data.host
        if (!choices.has(port)) {
          choices.set(port, { name: `${labelHost}:${port}`, value: port })
        }
      }

      const commonPorts = selectedHost === 'archipelago.gg' || !selectedHost ? [38281] : []
      for (const port of commonPorts) {
        if (!choices.has(port)) {
          choices.set(port, { name: `${selectedHost || 'archipelago.gg'}:${port}`, value: port })
        }
      }

      if (/^\d+$/.test(typed)) {
        const typedPort = parseInt(typed)
        if (!Number.isNaN(typedPort) && typedPort >= 1 && typedPort <= 65535 && !choices.has(typedPort)) {
          choices.set(typedPort, { name: `${selectedHost || 'custom-host'}:${typedPort}`, value: typedPort })
        }
      }

      const results = Array.from(choices.values())
        .filter(choice => typed.length === 0 || String(choice.value).includes(typed))
        .slice(0, 25)

      await interaction.respond(results)
      return
    }

    if (focused.name === 'player') {
      const typed = String(focused.value ?? '').trim().toLowerCase()
      const choices = new Map<string, { name: string, value: string }>()

      const links = await Database.getLinks(interaction.guildId)
      for (const link of links) {
        const player = link.archipelago_name?.trim()
        if (player && !choices.has(player.toLowerCase())) {
          choices.set(player.toLowerCase(), { name: player, value: player })
        }
      }

      for (const monitor of Monitors.get(interaction.guildId)) {
        const player = monitor.data.player?.trim()
        if (player && !choices.has(player.toLowerCase())) {
          choices.set(player.toLowerCase(), { name: player, value: player })
        }
      }

      const results = Array.from(choices.values())
        .filter(choice => typed.length === 0 || choice.name.toLowerCase().includes(typed))
        .slice(0, 25)

      await interaction.respond(results)
      return
    }

    await interaction.respond([])
  }

  execute (interaction: ChatInputCommandInteraction) {
    const host = interaction.options.getString('host', true).trim()
    const game = interaction.options.getString('game')?.trim()

    const monitorData: MonitorData = {
      host,
      port: interaction.options.getInteger('port', true),
      game: game && game.length > 0 ? game : undefined,
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
      return interaction.reply({
        content: `Already monitoring ${uri}.`,
        flags: [MessageFlags.Ephemeral]
      })
    }

    interaction.reply({
      content: `Attempting to monitor ${uri}...`,
      flags: [MessageFlags.Ephemeral]
    }).catch(console.error)

    Monitors.make(monitorData, this.client)
      .then(async (monitor) => {
        monitor.data.id = await Database.makeConnection(monitorData)
        await interaction.followUp({
          content: `Now monitoring ${uri}.`,
          flags: [MessageFlags.Ephemeral]
        }).catch(console.error)
      })
      .catch(async (err) => {
        console.error('Failed to create monitor:', err)
        await interaction.followUp({
          content: 'Failed to connect. Check host/port/player/game.',
          flags: [MessageFlags.Ephemeral]
        }).catch(console.error)
      })
  }
}