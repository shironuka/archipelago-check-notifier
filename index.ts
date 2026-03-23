import { Client, Events, InteractionType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js'
import Commands from './src/commands'
import Database from './src/utils/database'
import Monitors from './src/utils/monitors'
import { Connection } from './src/classes/connection'
import { buildConnectionsView } from './src/commands/connectionscommand'

const client = new Client({ intents: ['Guilds'] })

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
    const connections: Connection[] = await Database.getConnections()
    console.log(`Reconnecting to ${connections.length} monitors...`)
    for (const result of connections) {
      if (Monitors.has(`${result.host}:${result.port}`)) {
        console.log(`Already monitoring ${result.host}:${result.port}, skipping...`)
        continue
      }
      Monitors.make(result, client).catch(err => {
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
      if (interaction.customId.startsWith('connections_prev:')) {
        if (!interaction.guildId) {
          await interaction.reply({ content: 'This button can only be used in a server.', flags: [MessageFlags.Ephemeral] })
          return
        }

        const currentPage = parseInt(interaction.customId.split(':')[1] ?? '0')
        const view = buildConnectionsView(interaction.guildId, currentPage - 1)
        await interaction.update(view)
        return
      }

      if (interaction.customId.startsWith('connections_next:')) {
        if (!interaction.guildId) {
          await interaction.reply({ content: 'This button can only be used in a server.', flags: [MessageFlags.Ephemeral] })
          return
        }

        const currentPage = parseInt(interaction.customId.split(':')[1] ?? '0')
        const view = buildConnectionsView(interaction.guildId, currentPage + 1)
        await interaction.update(view)
        return
      }

      if (interaction.customId.startsWith('connections_remove:')) {
        if (!interaction.guildId) {
          await interaction.reply({ content: 'This button can only be used in a server.', flags: [MessageFlags.Ephemeral] })
          return
        }

        const parts = interaction.customId.split(':')
        const encodedUri = parts[1] ?? ''
        const page = parseInt(parts[2] ?? '0')
        const uri = decodeURIComponent(encodedUri)

        if (Monitors.has(uri)) {
          Monitors.remove(uri)
        }

        const view = buildConnectionsView(interaction.guildId, page)
        await interaction.update(view)
        return
      }

      if (interaction.customId.startsWith('remonitor:')) {
        const connectionId = parseInt(interaction.customId.split(':')[1])
        const connection = await Database.getConnection(connectionId)
        if (!connection) {
          return interaction.reply({ content: 'Monitor configuration not found in database.', flags: [MessageFlags.Ephemeral] })
        }

        if (Monitors.has(`${connection.host}:${connection.port}`)) {
          Monitors.remove(`${connection.host}:${connection.port}`, false)
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })
        Monitors.make(connection, client).then(() => {
          interaction.editReply({ content: `Now monitoring Archipelago on ${connection.host}:${connection.port}.` })
        }).catch(err => {
          console.error('Failed to create monitor:', err)
          interaction.editReply({ content: 'Failed to connect to Archipelago. Please check if the server is up.' })
        })
      }
      return
    }

    switch (interaction.type) {
      case InteractionType.ApplicationCommandAutocomplete:
        Commands.Autocomplete(interaction)
        break
      case InteractionType.ApplicationCommand:
        Commands.Execute(interaction)
        await Database.createLog(interaction.guildId || '0', interaction.user.id, `Executed command ${interaction.commandName}`)
        break
    }
  } catch (err) {
    console.error('Interaction error:', err)
    if (interaction.type === InteractionType.ApplicationCommand) {
      if (interaction.replied || interaction.deferred) {
        interaction.followUp({ content: 'There was an error while executing this command!', flags: [MessageFlags.Ephemeral] }).catch(() => {})
      } else {
        interaction.reply({ content: 'There was an error while executing this command!', flags: [MessageFlags.Ephemeral] }).catch(() => {})
      }
    } else if (interaction.isButton()) {
      if (interaction.replied || interaction.deferred) {
        interaction.followUp({ content: 'There was an error while handling this button!', flags: [MessageFlags.Ephemeral] }).catch(() => {})
      } else {
        interaction.reply({ content: 'There was an error while handling this button!', flags: [MessageFlags.Ephemeral] }).catch(() => {})
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