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

function normalizeRoomUrl (raw?: string | null): string | null {
  const value = raw?.trim()
  if (!value) return null

  const normalized = value.replace(/\/+$/, '')

  if (!/^https?:\/\/archipelago\.gg\/room\/[^/\s?#]+/i.test(normalized)) {
    return null
  }

  return normalized
}

export default class MonitorCommand extends Command {
  name = 'monitor'
  description = 'Start tracking an Archipelago session (archipelago.gg).'

  options: ApplicationCommandOption[] = [
    {
      type: ApplicationCommandOptionType.Integer,
      name: 'port',
      description: 'The port to use',
      required: true
    },
    {
      type: ApplicationCommandOptionType.String,
      name: 'player',
      description: 'The Archipelago slot/player name',
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
      name: 'room_url',
      description: 'Optional Archipelago room page URL, used to wake/reconnect inactive rooms',
      required: false
    },
    {
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText],
      name: 'channel',
      description: 'Optional channel to send messages to. Uses LOG_CHANNEL if omitted.',
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

    if (focused.name === 'player') {
      const typed = String(focused.value ?? '').trim().toLowerCase()
      const choices = new Map<string, { name: string, value: string }>()

      try {
        const links = await Database.getLinks(interaction.guildId)
        for (const link of links) {
          const player = link.archipelago_name?.trim()
          if (player && !choices.has(player.toLowerCase())) {
            choices.set(player.toLowerCase(), { name: player, value: player })
          }
        }
      } catch (err) {
        console.error('Failed to get links for player autocomplete:', err)
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

  async execute (interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    const game = interaction.options.getString('game')?.trim()
    const rawRoomUrl = interaction.options.getString('room_url')?.trim()
    const roomUrl = normalizeRoomUrl(rawRoomUrl)

    if (rawRoomUrl && roomUrl == null) {
      await interaction.reply({
        content: 'Invalid room_url. Use the Archipelago room page URL, like `https://archipelago.gg/room/abc123`.',
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    const explicitChannel = interaction.options.getChannel('channel')
    const fallbackChannelId = process.env.LOG_CHANNEL?.trim()
    const resolvedChannelId = explicitChannel?.id ?? fallbackChannelId

    if (!resolvedChannelId) {
      await interaction.reply({
        content: 'No channel was provided and LOG_CHANNEL is not set.',
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    const monitorData = new MonitorData({
      host: 'archipelago.gg',
      port: interaction.options.getInteger('port', true),
      player: interaction.options.getString('player', true).trim(),
      channel: resolvedChannelId,
      game: game && game.length > 0 ? game : undefined,
      room_url: roomUrl,
      mention_join_leave: interaction.options.getBoolean('mention_join_leave') ?? false,
      mention_item_finder: interaction.options.getBoolean('mention_item_finder') ?? true,
      mention_item_receiver: interaction.options.getBoolean('mention_item_receiver') ?? true,
      mention_completion: interaction.options.getBoolean('mention_completion') ?? true,
      mention_hints: interaction.options.getBoolean('mention_hints') ?? true
    })

    const uri = `${monitorData.host}:${monitorData.port}`

    if (Monitors.has(uri)) {
      if (roomUrl != null) {
        try {
          const savedConnections = await Database.getConnections()
          const matchingConnections = savedConnections.filter((connection: any) =>
            String(connection.host).trim() === monitorData.host &&
            Number(connection.port) === monitorData.port &&
            String(connection.channel) === String(resolvedChannelId)
          )

          for (const connection of matchingConnections) {
            await Database.updateConnectionRoomUrl(Number(connection.id), roomUrl)
          }

          const liveMonitor = Monitors.getByRoomKey(Monitors.getRoomKeyFromData(monitorData))
          if (liveMonitor != null) {
            liveMonitor.data.room_url = roomUrl
          }

          await interaction.reply({
            content: `Already monitoring ${uri}. Saved room URL for reconnect wake-ups: ${roomUrl}`,
            flags: [MessageFlags.Ephemeral]
          })
          return
        } catch (err) {
          console.error('Failed to update saved room URL:', err)
          await interaction.reply({
            content: `Already monitoring ${uri}, but I failed to save the room URL.`,
            flags: [MessageFlags.Ephemeral]
          })
          return
        }
      }

      await interaction.reply({
        content: `Already monitoring ${uri}.`,
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    await interaction.reply({
      content: roomUrl != null
        ? `Attempting to monitor ${uri} with room wake URL saved...`
        : `Attempting to monitor ${uri}...`,
      flags: [MessageFlags.Ephemeral]
    })

    Monitors.make(monitorData, this.client)
      .then(async (monitor) => {
        monitor.data.id = await Database.makeConnection(monitorData)

        await interaction.followUp({
          content: roomUrl != null
            ? `Now monitoring ${uri} in <#${resolvedChannelId}>. Room wake URL saved.`
            : `Now monitoring ${uri} in <#${resolvedChannelId}>.`,
          flags: [MessageFlags.Ephemeral]
        })
      })
      .catch(async (err) => {
        console.error('Failed to create monitor:', err)
        await interaction.followUp({
          content: 'Failed to connect. Check port, player, optional game, and room URL.',
          flags: [MessageFlags.Ephemeral]
        })
      })
  }
}