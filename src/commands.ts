import { AutocompleteInteraction, Client, CommandInteraction, REST, Routes } from 'discord.js'
import MonitorCommand from './commands/monitorcommand'
import UnmonitorCommand from './commands/unmonitorcommand'
import Command from './classes/command'
import PingCommand from './commands/pingcommand'
import LinkCommand from './commands/linkcommand'
import UnlinkCommand from './commands/unlinkcommand'
import LinksCommand from './commands/linkscommand'
import RefreshCommand from './commands/refreshcommand'
import MonitorAdvanceCommand from './commands/monitoradvancecommand'
import ConnectionsCommand from './commands/connectionscommand'

let restClient: REST

const commandList: Command[] = []

const debugCommandList: Command[] = []

async function Init (client: Client) {
  commandList.length = 0
  debugCommandList.length = 0

  commandList.push(new PingCommand(client))
  commandList.push(new MonitorCommand(client))
  commandList.push(new MonitorAdvanceCommand(client))
  commandList.push(new ConnectionsCommand(client))
  commandList.push(new UnmonitorCommand(client))
  commandList.push(new LinkCommand(client))
  commandList.push(new UnlinkCommand(client))
  commandList.push(new LinksCommand(client))
  commandList.push(new RefreshCommand(client))

  if (client.token == null || client.application == null) return

  restClient = new REST({ version: '10' }).setToken(client.token)

  const commands = GetCommands()
  const debugCommands = GetDebugCommands()

  if (process.env.GUILD_ID) {
    await restClient.put(
      Routes.applicationGuildCommands(client.application.id, process.env.GUILD_ID),
      { body: [...commands, ...debugCommands] }
    )
    console.log('Registered guild commands')

    await restClient.put(
      Routes.applicationCommands(client.application.id),
      { body: [] }
    )
    console.log('Cleared global commands')
  } else {
    await restClient.put(
      Routes.applicationCommands(client.application.id),
      { body: commands }
    )
    console.log('Registered global commands')
  }
}

function GetCommands () {
  return commandList.map(command => ({
    name: command.name,
    description: command.description,
    options: command.options
  }))
}

function GetDebugCommands () {
  return debugCommandList.map(command => ({
    name: command.name,
    description: command.description,
    options: command.options
  }))
}

function Autocomplete (interaction: AutocompleteInteraction) {
  const command = [...commandList, ...debugCommandList].find(command => command.name === interaction.commandName)
  if (command == null) return

  command.autocomplete(interaction)
}

function Execute (interaction: CommandInteraction) {
  const command = [...commandList, ...debugCommandList].find(command => command.name === interaction.commandName)
  if (command == null) return

  if (interaction.isChatInputCommand()) {
    command.execute(interaction)
  }
}

const Commands = {
  init: Init,
  GetCommands,
  Execute,
  Autocomplete
}

export default Commands