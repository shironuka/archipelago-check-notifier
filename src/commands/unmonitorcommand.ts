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

    const choices = Monitors.get(interaction.guildId)
      .map(monitor => {
        const uri = monitor.client.uri ?? `${monitor.data.host}:${monitor.data.port}`
        return { name: uri, value: uri }
      })
      .filter(choice => choice.name.length >= 1 && choice.name.length <= 100)
      .filter(choice => focused.length === 0 || choice.name.toLowerCase().includes(focused))
      .slice(0, 25)

    void interaction.respond(choices)
  }
}
