import MonitorData from '../classes/monitordata'
import { Client, itemsHandlingFlags } from 'archipelago.js'
import Monitor from '../classes/monitor'
import { Client as DiscordClient } from 'discord.js'
import Database from './database'

const monitors: Monitor[] = []

function make (data: MonitorData, client: DiscordClient): Promise<Monitor> {
  return new Promise<Monitor>((resolve, reject) => {
    const existing = monitors.find(
      monitor => `${monitor.data.host}:${monitor.data.port}` === `${data.host}:${data.port}`
    )

    if (existing != null) {
      console.log(`Already monitoring ${data.host}:${data.port}, skipping...`)
      resolve(existing)
      return
    }

    const archi = new Client()

    const connectionOptions = {
      items: itemsHandlingFlags.all,
      tags: ['Tracker']
    }

    const uri = `${data.host}:${data.port}`

    const loginPromise = data.game != null && data.game.length > 0
      ? archi.login(uri, data.player, data.game, connectionOptions)
      : archi.login(uri, data.player, undefined, connectionOptions)

    loginPromise.then(() => {
      const monitor = new Monitor(archi, data, client)
      Database.createLog(monitor.guild.id, '0', `Connected to ${data.host}:${data.port}`)
      monitors.push(monitor)
      resolve(monitor)
    }).catch((err) => {
      console.log(err)
      reject(err)
    })
  })
}

function remove (uri: string, removeFromDb: boolean = true) {
  const monitor = monitors.find((monitor) => monitor.client.uri?.includes(uri) || `${monitor.data.host}:${monitor.data.port}` === uri)
  if (monitor == null) return
  monitors.splice(monitors.indexOf(monitor), 1)
  monitor.stop()
  if (removeFromDb) {
    Database.removeConnection(monitor)
  }
  Database.createLog(monitor.guild.id, '0', `Disconnected from ${monitor.data.host}:${monitor.data.port}`)
}

function has (uri: string) {
  return monitors.some((monitor) => monitor.client.uri?.includes(uri) || `${monitor.data.host}:${monitor.data.port}` === uri)
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