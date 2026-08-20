import {
  Client,
  Events,
  InteractionType,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField
} from 'discord.js'
import Commands from './src/commands'
import Database from './src/utils/database'
import Monitors from './src/utils/monitors'
import { Connection } from './src/classes/connection'
import { buildConnectionsView } from './src/commands/connectionscommand'
import { buildLinksView } from './src/commands/linkscommand'
import { getCurrentRoomConnectInfo } from './src/utils/archipelagoroom'

type SavedConnection = Connection & {
  room_url?: string | null
}

const client = new Client({ intents: ['Guilds'] })

function sleep (ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getSavedRoomKey (connection: SavedConnection) {
  return `${String(connection.host).trim()}:${Number(connection.port)}|${String(connection.channel)}`
}

function getFirstRoomUrl (connections: SavedConnection[]) {
  return connections
    .map(connection => connection.room_url?.trim())
    .find(roomUrl => roomUrl != null && roomUrl.length > 0) ?? null
}

async function refreshConnectionsFromRoomUrl (connections: SavedConnection[]) {
  const firstConnection = connections[0]

  if (firstConnection == null) {
    return {
      attempted: false,
      changed: false,
      message: 'No saved connections were available to refresh.'
    }
  }

  const roomUrl = getFirstRoomUrl(connections)

  if (roomUrl == null) {
    return {
      attempted: false,
      changed: false,
      message: 'No room URL is saved for this room.'
    }
  }

  const oldHost = String(firstConnection.host).trim()
  const oldPort = Number(firstConnection.port)
  const channel = String(firstConnection.channel)

  const currentRoomInfo = await getCurrentRoomConnectInfo(roomUrl)

  if (currentRoomInfo == null) {
    return {
      attempted: true,
      changed: false,
      message: 'Fetched the room page, but could not find a current /connect address.'
    }
  }

  const newHost = currentRoomInfo.host.trim()
  const newPort = Number(currentRoomInfo.port)

  if (!newHost || !Number.isFinite(newPort)) {
    return {
      attempted: true,
      changed: false,
      message: 'Fetched the room page, but the parsed connect address was invalid.'
    }
  }

  const changed = newHost !== oldHost || newPort !== oldPort

  if (changed) {
    await Database.updateConnectionHostPortForRoom(
      oldHost,
      oldPort,
      channel,
      newHost,
      newPort
    )

    for (const connection of connections) {
      connection.host = newHost
      connection.port = newPort
    }
  }

  // Give archipelago.gg a moment after the room page is fetched/woken.
  await sleep(3000)

  return {
    attempted: true,
    changed,
    message: changed
      ? `Room page refreshed. Updated connection from ${oldHost}:${oldPort} to ${newHost}:${newPort}.`
      : `Room page refreshed. Connection is still ${newHost}:${newPort}.`
  }
}

async function reconnectSavedConnectionWithRetries (
  connection: SavedConnection,
  attempts: number = 5,
  delayMs: number = 5000
) {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(
        `Reconnect attempt ${attempt}/${attempts} for ${connection.host}:${connection.port} as ${connection.player}`
      )

      return await Monitors.make(connection, client)
    } catch (err) {
      lastError = err

      console.error(
        `Reconnect attempt ${attempt}/${attempts} failed for ${connection.host}:${connection.port} as ${connection.player}:`,
        err
      )

      if (attempt < attempts) {
        await sleep(delayMs)
      }
    }
  }

  throw lastError
}

client.on(Events.ClientReady, async () => {
  console.log('DB HOST:', process.env.MYSQLHOST)
  console.log('DB PORT:', process.env.MYSQLPORT)
  console.log('DB USER:', process.env.MYSQLUSER)
  console.log('DB DATABASE:', process.env.MYSQLDATABASE)

  try {
    await Database.migrate()
    console.log('Database migrated.')
  } catch (err) {
    console.error('Database migration failed:', err)
  }

  try {
    await Commands.init(client)
    console.log('Commands initialized.')
  } catch (err) {
    console.error('Command initialization failed:', err)
  }

  try {
    const connections: SavedConnection[] = await Database.getConnections()
    console.log(`Reconnecting to ${connections.length} monitors...`)

    for (const result of connections) {
      const startMonitor = async () => {
        try {
          const refreshResult = await refreshConnectionsFromRoomUrl([result])
          if (refreshResult.attempted) {
            console.log(refreshResult.message)
          }
        } catch (err) {
          console.error(`Failed to refresh room URL for ${result.host}:${result.port}:`, err)
        }

        await reconnectSavedConnectionWithRetries(result, 5, 5000)
      }

      startMonitor().catch(err => {
        console.error(`Failed to reconnect to monitor ${result.host}:${result.port}:`, err)

        const channel = client.channels.cache.get(result.channel)
        if (channel?.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('Archipelago')
            .setDescription(`Failed to reconnect to monitor ${result.host}:${result.port} on startup.`)

          const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`remonitor:${result.id}`)
                .setLabel('Re-monitor')
                .setStyle(ButtonStyle.Primary)
            )

          ;(channel as any).send({ embeds: [embed], components: [row] }).catch(console.error)
        }
      })
    }
  } catch (err) {
    console.error('Failed to load connections from database:', err)
  }
})

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      const isManageConnectionsButton =
        interaction.customId.startsWith('connections_remove_room:') ||
        interaction.customId.startsWith('connections_reconnect_room:')

      if (isManageConnectionsButton) {
        const member = interaction.member
        const hasAdmin =
          member != null &&
          'permissions' in member &&
          member.permissions instanceof PermissionsBitField &&
          member.permissions.has(PermissionsBitField.Flags.ManageGuild)

        if (!hasAdmin) {
          await interaction.reply({
            content: 'You do not have permission to manage connections.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }
      }

      if (interaction.customId.startsWith('connections_prev:')) {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This button can only be used in a server.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }

        const page = parseInt(interaction.customId.split(':')[1] ?? '0')
        const view = await buildConnectionsView(interaction.guildId, page - 1)
        await interaction.update(view)
        return
      }

      if (interaction.customId.startsWith('connections_next:')) {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This button can only be used in a server.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }

        const page = parseInt(interaction.customId.split(':')[1] ?? '0')
        const view = await buildConnectionsView(interaction.guildId, page + 1)
        await interaction.update(view)
        return
      }

      if (interaction.customId.startsWith('connections_remove_room:')) {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This button can only be used in a server.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }

        const parts = interaction.customId.split(':')
        const encodedRoomKey = parts[1] ?? ''
        const page = parseInt(parts[2] ?? '0')
        const roomKey = decodeURIComponent(encodedRoomKey)

        await Monitors.removeByRoomKey(roomKey, true)

        const view = await buildConnectionsView(interaction.guildId, page)
        await interaction.update(view)
        return
      }

      if (interaction.customId.startsWith('connections_reconnect_room:')) {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This button can only be used in a server.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }

        const parts = interaction.customId.split(':')
        const encodedRoomKey = parts[1] ?? ''
        const page = parseInt(parts[2] ?? '0')
        const roomKey = decodeURIComponent(encodedRoomKey)

        await interaction.deferUpdate()

        const savedConnections: SavedConnection[] = await Database.getConnections()

        const matchingConnections = savedConnections.filter((connection) => {
          return getSavedRoomKey(connection) === roomKey
        })

        if (matchingConnections.length === 0) {
          const view = await buildConnectionsView(interaction.guildId, page)
          await interaction.editReply(view)

          await interaction.followUp({
            content: 'No saved connection was found for that room, so I could not reconnect it.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }

        let refreshMessage = ''
        try {
          const refreshResult = await refreshConnectionsFromRoomUrl(matchingConnections)
          refreshMessage = refreshResult.message
        } catch (err) {
          console.error(`Failed to refresh room page for ${roomKey}:`, err)
          refreshMessage = 'Tried to refresh the room page, but it failed. I attempted reconnect with the saved host and port.'
        }

        try {
          await Monitors.removeByRoomKey(roomKey, false)
        } catch (err) {
          console.error(`Failed to disconnect old monitor for ${roomKey}:`, err)
        }

        const reconnectErrors: unknown[] = []

        for (const connection of matchingConnections) {
          try {
            await reconnectSavedConnectionWithRetries(connection, 5, 5000)
          } catch (err) {
            reconnectErrors.push(err)
            console.error(`Failed to restart monitor ${connection.host}:${connection.port}:`, err)
          }
        }

        const view = await buildConnectionsView(interaction.guildId, page)
        await interaction.editReply(view)

        if (reconnectErrors.length > 0) {
          await interaction.followUp({
            content: `${refreshMessage} I disconnected the old monitor, but failed to reconnect ${reconnectErrors.length} saved connection${reconnectErrors.length === 1 ? '' : 's'} for this room after multiple attempts.`,
            flags: [MessageFlags.Ephemeral]
          })
        } else {
          await interaction.followUp({
            content: `${refreshMessage} Disconnected the old monitor and started a fresh connection for that room.`,
            flags: [MessageFlags.Ephemeral]
          })
        }

        return
      }

      if (interaction.customId.startsWith('links_prev:')) {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This button can only be used in a server.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }

        const parts = interaction.customId.split(':')
        const currentPage = parseInt(parts[1] ?? '0')
        const userKey = parts[2] ?? 'all'
        const playerKey = parts[3] ?? 'all'

        const userId = userKey === 'all' ? undefined : userKey
        const playerFilter = playerKey === 'all' ? undefined : decodeURIComponent(playerKey)

        const links = await Database.getLinks(interaction.guildId)
        const view = buildLinksView(interaction.guildId, links, currentPage - 1, userId, playerFilter)
        await interaction.update(view)
        return
      }

      if (interaction.customId.startsWith('links_next:')) {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This button can only be used in a server.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }

        const parts = interaction.customId.split(':')
        const currentPage = parseInt(parts[1] ?? '0')
        const userKey = parts[2] ?? 'all'
        const playerKey = parts[3] ?? 'all'

        const userId = userKey === 'all' ? undefined : userKey
        const playerFilter = playerKey === 'all' ? undefined : decodeURIComponent(playerKey)

        const links = await Database.getLinks(interaction.guildId)
        const view = buildLinksView(interaction.guildId, links, currentPage + 1, userId, playerFilter)
        await interaction.update(view)
        return
      }

      if (interaction.customId.startsWith('remonitor:')) {
        const connectionId = parseInt(interaction.customId.split(':')[1])
        const connection = await Database.getConnection(connectionId) as SavedConnection | null

        if (!connection) {
          await interaction.reply({
            content: 'Monitor configuration not found in database.',
            flags: [MessageFlags.Ephemeral]
          })
          return
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })

        const oldUri = `${connection.host}:${connection.port}`

        let refreshMessage = ''
        try {
          const refreshResult = await refreshConnectionsFromRoomUrl([connection])
          refreshMessage = refreshResult.message
        } catch (err) {
          console.error(`Failed to refresh room URL for ${oldUri}:`, err)
          refreshMessage = 'Tried to refresh the room page, but it failed. I attempted reconnect with the saved host and port.'
        }

        const newUri = `${connection.host}:${connection.port}`

        if (Monitors.has(oldUri)) {
          await Monitors.remove(oldUri, false)
        }

        if (newUri !== oldUri && Monitors.has(newUri)) {
          await Monitors.remove(newUri, false)
        }

        reconnectSavedConnectionWithRetries(connection, 5, 5000).then(() => {
          interaction.editReply({
            content: `${refreshMessage} Now monitoring Archipelago on ${connection.host}:${connection.port}.`
          })
        }).catch(err => {
          console.error('Failed to create monitor:', err)
          interaction.editReply({
            content: `${refreshMessage} Failed to connect to Archipelago after multiple attempts. Please check if the server is up.`
          })
        })

        return
      }

      return
    }

    switch (interaction.type) {
      case InteractionType.ApplicationCommandAutocomplete:
        Commands.Autocomplete(interaction)
        break

      case InteractionType.ApplicationCommand:
        Commands.Execute(interaction)
        await Database.createLog(
          interaction.guildId || '0',
          interaction.user.id,
          `Executed command ${interaction.commandName}`
        )
        break
    }
  } catch (err) {
    console.error('Interaction error:', err)

    if (interaction.type === InteractionType.ApplicationCommand) {
      if (interaction.replied || interaction.deferred) {
        interaction.followUp({
          content: 'There was an error while executing this command!',
          flags: [MessageFlags.Ephemeral]
        }).catch(() => {})
      } else {
        interaction.reply({
          content: 'There was an error while executing this command!',
          flags: [MessageFlags.Ephemeral]
        }).catch(() => {})
      }
    } else if (interaction.isButton()) {
      if (interaction.replied || interaction.deferred) {
        interaction.followUp({
          content: 'There was an error while handling this button!',
          flags: [MessageFlags.Ephemeral]
        }).catch(() => {})
      } else {
        interaction.reply({
          content: 'There was an error while handling this button!',
          flags: [MessageFlags.Ephemeral]
        }).catch(() => {})
      }
    }
  }
})

client.on(Events.GuildCreate, async (guild) => {
  await Database.createLog(guild.id, '0', 'Added to guild')

  if (process.env.LOG_CHANNEL) {
    const channel = client.channels.cache.get(process.env.LOG_CHANNEL)
    if (channel?.isTextBased()) {
      (channel as any).send(`Added to guild ${guild.name}`).catch(console.error)
    }
  }
})

client.on(Events.GuildDelete, async (guild) => {
  await Database.createLog(guild.id, '0', 'Removed from guild')
})

client.login(process.env.DISCORD_TOKEN)