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
import { getCurrentRoomConnectInfo } from '../utils/archipelagoroom'

function normalizeRoomUrl (raw?: string | null): string | null {
  const value = raw?.trim()
  if (!value) return null

  const withProtocol = /^https?:\/\//i.test(value)
    ? value
    : `https://${value}`

  const normalized = withProtocol.replace(/\/+$/, '')

  if (!/^https?:\/\/archipelago\.gg\/room\/[^/\s?#]+/i.test(normalized)) {
    return null
  }

  return normalized
}

export default class MonitorCommand extends Command {
  name = 'monitor'
  description = 'Start tracking an Archipelago session from an archipelago.gg room URL.'

  options: ApplicationCommandOption[] = [
    {
      type: ApplicationCommandOptionType.String,
      name: 'room_url',
      description: 'Archipelago room page URL, used to get the current port and wake inactive rooms',
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
      type: ApplicationCommandOptionType.Integer,
      name: 'port',
      description: 'Optional fallback port if the room page cannot be read',
      required: false
    },
    {
      type: ApplicationCommandOptionType.String,
      name: 'game',
      description: 'Optional game name',
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

    const rawRoomUrl = interaction.options.getString('room_url', true).trim()
    const roomUrl = normalizeRoomUrl(rawRoomUrl)

    if (roomUrl == null) {
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

    const game = interaction.options.getString('game')?.trim()
    const fallbackPort = interaction.options.getInteger('port')

    await interaction.deferReply({
      flags: [MessageFlags.Ephemeral]
    })

    let host = 'archipelago.gg'
    let port = fallbackPort ?? 0
    let roomFetchMessage = ''

    try {
      const roomInfo = await getCurrentRoomConnectInfo(roomUrl)

      if (roomInfo == null) {
        if (fallbackPort == null) {
          await interaction.editReply({
            content: 'I fetched the room page, but could not find the current `/connect archipelago.gg:PORT` value. Try again, or provide `port` as a fallback.'
          })
          return
        }

        roomFetchMessage = `I fetched the room page, but could not find the current port. Using fallback port ${fallbackPort}.`
      } else {
        host = roomInfo.host
        port = roomInfo.port
        roomFetchMessage = `Room page read successfully. Current connection is ${host}:${port}.`
      }
    } catch (err) {
      console.error('Failed to fetch Archipelago room page:', err)

      if (fallbackPort == null) {
        await interaction.editReply({
          content: 'Failed to fetch the Archipelago room page, and no fallback port was provided. Try again, or provide `port` as a fallback.'
        })
        return
      }

      roomFetchMessage = `Failed to fetch the room page. Using fallback port ${fallbackPort}.`
    }

    const monitorData = new MonitorData({
      host,
      port,
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

        await interaction.editReply({
          content: `${roomFetchMessage} Already monitoring ${uri}. Saved room URL for reconnect wake-ups: ${roomUrl}`
        })
        return
      } catch (err) {
        console.error('Failed to update saved room URL:', err)
        await interaction.editReply({
          content: `${roomFetchMessage} Already monitoring ${uri}, but I failed to save the room URL.`
        })
        return
      }
    }

    await interaction.editReply({
      content: `${roomFetchMessage} Attempting to monitor ${uri}...`
    })

    try {
      const monitor = await Monitors.make(monitorData, this.client)
      monitor.data.id = await Database.makeConnection(monitorData)

      await interaction.editReply({
        content: `Now monitoring ${uri} in <#${resolvedChannelId}>. Room wake URL saved: ${roomUrl}`
      })
    } catch (err) {
      console.error('Failed to create monitor:', err)
      await interaction.editReply({
        content: `${roomFetchMessage} Failed to connect. Check room URL, player, optional game, and optional fallback port.`
      })
    }
  }
}