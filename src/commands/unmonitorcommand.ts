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

export default class UnmonitorCommand extends Command {
  name = 'unmonitor'
  description = 'Stop tracking an archipelago session.'

  options: ApplicationCommandOption[] = [
    {
      type: ApplicationCommandOptionType.String,
      name: 'uri',
      description: 'The URI of the archipelago room to remove.',
      required: true,
      autocomplete: true
    }
  ]

  constructor (client: any) {
    super()
    this.client = client
  }

  async execute (interaction: ChatInputCommandInteraction) {
    const uri = interaction.options.getString('uri', true)

    const liveExists = Monitors.has(uri)
    const dbMatches = await Database.findConnectionsByUri(uri)

    if (!liveExists && dbMatches.length === 0) {
      await interaction.reply({
        content: `There is no active or saved monitor on ${uri}.`,
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    await Monitors.remove(uri, true)

    await interaction.reply({
      content: `The tracker will no longer track ${uri}.`,
      flags: [MessageFlags.Ephemeral]
    })
  }

  async autocomplete (interaction: AutocompleteInteraction): Promise<void> {
    if (interaction.guildId == null) {
      await interaction.respond([])
      return
    }

    const focused = interaction.options.getFocused().toLowerCase()
    const uniqueChoices = new Map<string, { name: string, value: string }>()

    for (const monitor of Monitors.get(interaction.guildId)) {
      const uri = `${monitor.data.host}:${monitor.data.port}`

      if (uri.length < 1 || uri.length > 100) continue
      if (focused.length > 0 && !uri.toLowerCase().includes(focused)) continue

      if (!uniqueChoices.has(uri)) {
        uniqueChoices.set(uri, { name: uri, value: uri })
      }
    }

    const savedConnections = await Database.getConnections()
    for (const connection of savedConnections) {
      const uri = `${String(connection.host).trim()}:${Number(connection.port)}`

      if (uri.length < 1 || uri.length > 100) continue
      if (focused.length > 0 && !uri.toLowerCase().includes(focused)) continue

      if (!uniqueChoices.has(uri)) {
        uniqueChoices.set(uri, { name: uri, value: uri })
      }
    }

    await interaction.respond(Array.from(uniqueChoices.values()).slice(0, 25))
  }
}