import Command from '../classes/command'
import {
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js'
import Monitors from '../utils/monitors'
import Database from '../utils/database'

export default class SetCompletionCommand extends Command {
  name = 'setcompletion'
  description = 'Manually mark a player as completed or not.'

  options = [
    {
      name: 'port',
      description: 'Port of the room',
      type: 4, // INTEGER
      required: true
    },
    {
      name: 'player',
      description: 'Player name',
      type: 3, // STRING
      required: true
    },
    {
      name: 'completed',
      description: 'Whether the player is completed',
      type: 5, // BOOLEAN
      required: true
    },
    {
      name: 'host',
      description: 'Host (optional)',
      type: 3,
      required: false
    },
    {
      name: 'game',
      description: 'Game (optional)',
      type: 3,
      required: false
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

    const port = interaction.options.getInteger('port', true)
    const player = interaction.options.getString('player', true).trim()
    const completed = interaction.options.getBoolean('completed', true)
    const host = interaction.options.getString('host', false)?.trim()
    const game = interaction.options.getString('game', false)?.trim()

    const monitors = Monitors.get(interaction.guildId)

    let candidates = monitors.filter((monitor: any) =>
      monitor.data.channel === interaction.channelId &&
      monitor.data.port === port &&
      (host == null || host.length === 0 || monitor.data.host.trim() === host)
    )

    if (candidates.length >= 1) {
      const monitor = candidates[0]
      await monitor.setPlayerCompletedState(player, completed, game)

      await interaction.reply({
        content: `Set completion for \`${player}\` on \`${monitor.data.host}:${monitor.data.port}\` to \`${completed}\`.`,
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    const allConnections = await Database.getConnections()

    const connection = allConnections.find((c: any) =>
      String(c.channel) === interaction.channelId &&
      Number(c.port) === port &&
      (host == null || String(c.host).trim() === host)
    )

    if (!connection) {
      await interaction.reply({
        content: 'No matching room found.',
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    const roomKey = `${connection.host}:${connection.port}|${connection.channel}`

    await Database.setPresenceCompleted(
      roomKey,
      String(connection.host),
      Number(connection.port),
      String(connection.channel),
      player,
      game ?? connection.game,
      completed
    )

    await interaction.reply({
      content: `Set completion for \`${player}\` on \`${connection.host}:${connection.port}\` to \`${completed}\`.`,
      flags: [MessageFlags.Ephemeral]
    })
  }
}