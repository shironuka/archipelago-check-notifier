import Command from '../classes/command'
import {
  ApplicationCommandOption,
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js'
import Monitors from '../utils/monitors'

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

  execute (interaction: ChatInputCommandInteraction) {
    const uri = interaction.options.getString('uri', true)

    if (!Monitors.has(uri)) {
      interaction.reply({
        content: `There is no active monitor on ${uri}.`,
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    Monitors.remove(uri)

    interaction.reply({
      content: `The tracker will no longer track ${uri}.`,
      flags: [MessageFlags.Ephemeral]
    })
  }

  autocomplete (interaction: AutocompleteInteraction): void {
    if (interaction.guildId == null) {
      void interaction.respond([])
      return
    }

    const focused = interaction.options.getFocused().toLowerCase()
    const uniqueChoices = new Map<string, { name: string, value: string }>()

    for (const monitor of Monitors.get(interaction.guildId)) {
      const uri = monitor.client.uri ?? `${monitor.data.host}:${monitor.data.port}`

      if (uri.length < 1 || uri.length > 100) continue
      if (focused.length > 0 && !uri.toLowerCase().includes(focused)) continue

      if (!uniqueChoices.has(uri)) {
        uniqueChoices.set(uri, { name: uri, value: uri })
      }
    }

    void interaction.respond(Array.from(uniqueChoices.values()).slice(0, 25))
  }
}
