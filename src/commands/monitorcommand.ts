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
  description = 'Start tracking an Archipelago session (archipelago.gg).'

  options: ApplicationCommandOption[] = [
    {
      type: ApplicationCommandOptionType.Integer,
      name: 'port',
      description: 'The port to use',
      required: true,
      autocomplete: true
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
      type: ApplicationCommandOptionType.String,
      name: 'game',
      description: 'Optional game name',
      required: false
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

    if (focused.name === 'port') {
      const typed = String(focused.value ?? '').trim()
      const choices = new Map<number, { name: string, value: number }>()

      for (const monitor of Monitors.get(interaction.guildId)) {
        if (monitor.data.host !== 'archipelago.gg') continue

        const port = monitor.data.port
        if (!choices.has(port)) {
          choices.set(port, {
            name: `archipelago.gg:${port}`,
            value: port
          })
        }
      }

      const commonPorts = [38281]
      for (const port of commonPorts) {
        if (!choices.has(port)) {
          choices.set(port, {
            name: `archipelago.gg:${port}`,
            value: port
          })
        }
      }

      if (/^\d+$/.test(typed)) {
        const typedPort = parseInt(typed)
        if (!Number.isNaN(typedPort) && typedPort >= 1 && typedPort <= 65535 && !choices.has(typedPort)) {
          choices.set(typedPort, {
            name: `archipelago.gg:${typedPort}`,
            value: typedPort
          })
        }
      }

      await interaction.respond(
        Array.from(choices.values())
          .filter(choice => typed.length === 0 || String(choice.value).includes(typed))
          .slice(0, 25)
      )
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

      await interaction.respond(
        Array.from(choices.values())
          .filter(choice => typed.length === 0 || choice.name.toLowerCase().includes(typed))
          .slice(0, 25)
      )
      return
    }

    await interaction.respond([])
  }

  execute (interaction: ChatInputCommandInteraction) {
    const game = interaction.options.getString('game')?.trim()

    const monitorData: MonitorData = {
      host: 'archipelago.gg',
      port: interaction.options.getInteger('port', true),
      player: interaction.options.getString('player', true).trim(),
      channel: interaction.options.getChannel('channel', true).id,
      game: game && game.length > 0 ? game : undefined,
      mention_join_leave: interaction.options.getBoolean('mention_join_leave') ?? false,
      mention_item_finder: interaction.options.getBoolean('mention_item_finder') ?? true,
      mention_item_receiver: interaction.options.getBoolean('mention_item_receiver') ?? true,
      mention_completion: interaction.options.getBoolean('mention_completion') ?? true,
      mention_hints: interaction.options.getBoolean('mention_hints') ?? true
    }

    const uri = `${monitorData.host}:${monitorData.port}`

    if (Monitors.has(uri)) {
      void interaction.reply({
        content: `Already monitoring ${uri}.`,
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    void interaction.reply({
      content: `Attempting to monitor ${uri}...`,
      flags: [MessageFlags.Ephemeral]
    })

    Monitors.make(monitorData, this.client)
      .then(async (monitor) => {
        monitor.data.id = await Database.makeConnection(monitorData)
        await interaction.followUp({
          content: `Now monitoring ${uri}.`,
          flags: [MessageFlags.Ephemeral]
        })
      })
      .catch(async (err) => {
        console.error('Failed to create monitor:', err)
        await interaction.followUp({
          content: 'Failed to connect. Check port, player, and optional game.',
          flags: [MessageFlags.Ephemeral]
        })
      })
  }
}