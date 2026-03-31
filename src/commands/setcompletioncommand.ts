import Command from '../classes/command'
import {
  ApplicationCommandOption,
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js'
import Monitors from '../utils/monitors'
import Database from '../utils/database'

type Choice = {
  name: string
  value: string
}

function buildRoomKey (host: string, port: number, channel: string) {
  return `${host.trim()}:${port}|${channel}`
}

function parseRoomKey (roomKey: string) {
  const [hostPort, channel] = roomKey.split('|')
  if (!hostPort || !channel) return null

  const lastColon = hostPort.lastIndexOf(':')
  if (lastColon === -1) return null

  const host = hostPort.slice(0, lastColon).trim()
  const port = parseInt(hostPort.slice(lastColon + 1), 10)

  if (!host || !Number.isFinite(port)) return null

  return { host, port, channel }
}

export default class SetCompletionCommand extends Command {
  name = 'setcompletion'
  description = 'Manually mark a player as completed or not completed for a room.'

  options: ApplicationCommandOption[] = [
    {
      type: ApplicationCommandOptionType.String,
      name: 'monitor',
      description: 'The monitor/room to update.',
      required: true,
      autocomplete: true
    },
    {
      type: ApplicationCommandOptionType.String,
      name: 'player',
      description: 'The player to update.',
      required: true,
      autocomplete: true
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: 'completed',
      description: 'Whether the player is completed.',
      required: true
    }
  ]

  constructor (client: any) {
    super()
    this.client = client
  }

  async execute (interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({
        content: 'Server only command.',
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    const roomKey = interaction.options.getString('monitor', true)
    const player = interaction.options.getString('player', true).trim()
    const completed = interaction.options.getBoolean('completed', true)

    const parsed = parseRoomKey(roomKey)
    if (!parsed) {
      await interaction.reply({
        content: 'Invalid monitor selection.',
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    const { host, port, channel } = parsed

    const liveMonitor = Monitors
      .get(interaction.guildId)
      .find((monitor: any) =>
        monitor.data.host.trim() === host &&
        monitor.data.port === port &&
        String(monitor.data.channel) === channel
      )

    let savedGame: string | undefined

    const presenceRows = await Database.getPresenceForRoom(roomKey)
    const matchingPresence = presenceRows.find((row: any) => String(row.player_name).trim() === player)
    if (matchingPresence?.game != null) {
      savedGame = String(matchingPresence.game)
    }

    if (!savedGame) {
      const allConnections = await Database.getConnections()
      const matchingConnection = allConnections.find((row: any) =>
        String(row.host).trim() === host &&
        Number(row.port) === port &&
        String(row.channel) === channel &&
        String(row.player).trim() === player
      )

      if (matchingConnection?.game != null) {
        savedGame = String(matchingConnection.game)
      }
    }

    if (liveMonitor != null) {
      await liveMonitor.setPlayerCompletedState(player, completed, savedGame)

      await interaction.reply({
        content: `Set completion for \`${player}\` on \`${host}:${port}\` to \`${completed}\`.`,
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    await Database.setPresenceCompleted(
      roomKey,
      host,
      port,
      channel,
      player,
      savedGame,
      completed
    )

    await interaction.reply({
      content: `Set completion for \`${player}\` on \`${host}:${port}\` to \`${completed}\`.`,
      flags: [MessageFlags.Ephemeral]
    })
  }

  async autocomplete (interaction: AutocompleteInteraction): Promise<void> {
    if (interaction.guildId == null) {
      await interaction.respond([])
      return
    }

    const focused = interaction.options.getFocused(true)

    if (focused.name === 'monitor') {
      const typed = String(focused.value ?? '').toLowerCase()
      const choices = new Map<string, Choice>()

      for (const monitor of Monitors.get(interaction.guildId)) {
        const host = String(monitor.data.host).trim()
        const port = Number(monitor.data.port)
        const channel = String(monitor.data.channel)
        const roomKey = buildRoomKey(host, port, channel)
        const label = `${host}:${port} — <#${channel}>`

        if (typed.length > 0 && !label.toLowerCase().includes(typed) && !roomKey.toLowerCase().includes(typed)) {
          continue
        }

        if (!choices.has(roomKey)) {
          choices.set(roomKey, {
            name: label.slice(0, 100),
            value: roomKey
          })
        }
      }

      const savedConnections = await Database.getConnections()
      for (const connection of savedConnections) {
        const host = String(connection.host).trim()
        const port = Number(connection.port)
        const channel = String(connection.channel)
        const roomKey = buildRoomKey(host, port, channel)
        const label = `${host}:${port} — <#${channel}>`

        if (typed.length > 0 && !label.toLowerCase().includes(typed) && !roomKey.toLowerCase().includes(typed)) {
          continue
        }

        if (!choices.has(roomKey)) {
          choices.set(roomKey, {
            name: label.slice(0, 100),
            value: roomKey
          })
        }
      }

      await interaction.respond(Array.from(choices.values()).slice(0, 25))
      return
    }

    if (focused.name === 'player') {
      const typed = String(focused.value ?? '').toLowerCase()
      const selectedRoomKey = interaction.options.getString('monitor')

      if (!selectedRoomKey) {
        await interaction.respond([])
        return
      }

      const parsed = parseRoomKey(selectedRoomKey)
      if (!parsed) {
        await interaction.respond([])
        return
      }

      const { host, port, channel } = parsed
      const playerChoices = new Map<string, Choice>()

      const liveMonitor = Monitors
        .get(interaction.guildId)
        .find((monitor: any) =>
          monitor.data.host.trim() === host &&
          monitor.data.port === port &&
          String(monitor.data.channel) === channel
        )

      if (liveMonitor != null) {
        for (const player of liveMonitor.getAllRoomPlayers()) {
          const name = String(player.name).trim()
          if (!name) continue
          if (typed.length > 0 && !name.toLowerCase().includes(typed)) continue

          if (!playerChoices.has(name)) {
            playerChoices.set(name, {
              name: name.slice(0, 100),
              value: name
            })
          }
        }
      }

      const presenceRows = await Database.getPresenceForRoom(selectedRoomKey)
      for (const row of presenceRows) {
        const name = String(row.player_name).trim()
        if (!name) continue
        if (typed.length > 0 && !name.toLowerCase().includes(typed)) continue

        if (!playerChoices.has(name)) {
          playerChoices.set(name, {
            name: name.slice(0, 100),
            value: name
          })
        }
      }

      const savedConnections = await Database.getConnections()
      for (const connection of savedConnections) {
        if (
          String(connection.host).trim() !== host ||
          Number(connection.port) !== port ||
          String(connection.channel) !== channel
        ) {
          continue
        }

        const name = String(connection.player).trim()
        if (!name) continue
        if (typed.length > 0 && !name.toLowerCase().includes(typed)) continue

        if (!playerChoices.has(name)) {
          playerChoices.set(name, {
            name: name.slice(0, 100),
            value: name
          })
        }
      }

      await interaction.respond(Array.from(playerChoices.values()).slice(0, 25))
      return
    }

    await interaction.respond([])
  }
}