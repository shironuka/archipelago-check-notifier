import { AutocompleteInteraction, Client, CommandInteraction, REST, Routes } from 'discord.js'
import MonitorCommand from './commands/monitorcommand'
import UnmonitorCommand from './commands/unmonitorcommand'
import Command from './classes/command'
import PingCommand from './commands/pingcommand'
import LinkCommand from './commands/linkcommand'
import UnlinkCommand from './commands/unlinkcommand'
import LinksCommand from './commands/linkscommand'
import RefreshCommand from './commands/refreshcommand'
let restClient: REST

const commandList: Command[] = [
]

const debugCommandList: Command[] = [

]

async function Init (client: Client) {
  commandList.push(new PingCommand(client))
  commandList.push(new MonitorCommand(client))
  commandList.push(new UnmonitorCommand(client))
  commandList.push(new LinkCommand(client))
  commandList.push(new UnlinkCommand(client))
  commandList.push(new LinksCommand(client))
  commandList.push(new RefreshCommand(client))

  if (client.token == null || client.application == null) return

  restClient = new REST({ version: '10' }).setToken(client.token)

  // Register slash commands with Discord.js rest
  if (process.env.GUILD_ID) {
    await restClient.put(Routes.applicationGuildCommands(client.application?.id, process.env.GUILD_ID), { body: GetDebugCommands() })
  }
  await restClient.put(Routes.applicationCommands(client.application?.id), { body: GetCommands() })
}

function GetCommands () {
  return commandList.map(command => ({ name: command.name, description: command.description, options: command.options }))
}

function GetDebugCommands () {
  return debugCommandList.map(command => ({ name: command.name, description: command.description, options: command.options }))
}

function Autocomplete (interaction: AutocompleteInteraction) {
  const command = commandList.find(command => command.name === interaction.commandName)
  if (command == null) return

  command.autocomplete(interaction)
}

function Execute (interaction: CommandInteraction) {
  const command = commandList.find(command => command.name === interaction.commandName)
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
