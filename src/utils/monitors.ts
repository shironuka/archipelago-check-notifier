import MonitorData from '../classes/monitordata'
import { Client, itemsHandlingFlags } from 'archipelago.js'
import Monitor from '../classes/monitor'
import { Client as DiscordClient } from 'discord.js'
import Database from './database'

const monitors: Monitor[] = []

function make (data: MonitorData, client: DiscordClient): Promise<Monitor> {
  return new Promise<Monitor>((resolve, reject) => {
    // 🔧 Normalize inputs (VERY IMPORTANT)
    data.host = data.host.trim()
    data.player = data.player.trim()
    data.game = data.game?.trim()

    const uri = `${data.host}:${data.port}`

    const existing = monitors.find(
      monitor => `${monitor.data.host}:${monitor.data.port}` === uri
    )

    if (existing != null) {
      console.log(`Already monitoring ${uri}, skipping...`)
      resolve(existing)
      return
    }

    const archi = new Client()

    const connectionOptions = {
      items: itemsHandlingFlags.all,
      tags: ['Tracker']
    }

    // 🧠 DEBUG LOG (this is the key part)
    console.log('=== LOGIN DEBUG ===')
    console.log({
      uri,
      host: data.host,
      port: data.port,
      player: data.player,
      game: data.game,
      connectionOptions
    })
    console.log('===================')

    const loginPromise = data.game != null && data.game.length > 0
      ? archi.login(uri, data.player, data.game, connectionOptions)
      : archi.login(uri, data.player, undefined, connectionOptions)

    loginPromise.then(() => {
      console.log(`Connected successfully to ${uri} as ${data.player}`)

      const monitor = new Monitor(archi, data, client)
      Database.createLog(monitor.guild.id, '0', `Connected to ${uri}`)
      monitors.push(monitor)
      resolve(monitor)
    }).catch((err) => {
      console.error('=== LOGIN FAILED ===')
      console.error({
        uri,
        player: data.player,
        game: data.game,
        error: err
      })
      console.error('====================')

      reject(err)
    })
  })
}

function remove (uri: string, removeFromDb: boolean = true) {
  const monitor = monitors.find(
    (monitor) =>
      monitor.client.uri?.includes(uri) ||
      `${monitor.data.host}:${monitor.data.port}` === uri
  )

  if (monitor == null) return

  monitors.splice(monitors.indexOf(monitor), 1)
  monitor.stop()

  if (removeFromDb) {
    Database.removeConnection(monitor)
  }

  Database.createLog(
    monitor.guild.id,
    '0',
    `Disconnected from ${monitor.data.host}:${monitor.data.port}`
  )
}

function has (uri: string) {
  return monitors.some(
    (monitor) =>
      monitor.client.uri?.includes(uri) ||
      `${monitor.data.host}:${monitor.data.port}` === uri
  )
}

function get (guild: string) {
  return monitors.filter((monitor) => monitor.guild.id === guild)
}

const Monitors = {
  make,
  remove,
  has,
  get
}

export default Monitors