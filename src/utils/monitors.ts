import MonitorData from '../classes/monitordata'
import { Client, ConnectionInformation, ITEMS_HANDLING_FLAGS } from 'archipelago.js'
import Monitor from '../classes/monitor'
import { Client as DiscordClient } from 'discord.js'
import Database from './database'

const monitors: Monitor[] = []

function make (data: MonitorData, client: DiscordClient): Promise<Monitor> {
  return new Promise<Monitor>((resolve, reject) => {
    const archi = new Client()
    const connectionInfo: ConnectionInformation = {
      hostname: data.host,
      port: data.port,
      game: data.game,
      name: data.player,
      items_handling: itemsHandlingFlags.all,
      tags: ['IgnoreGame', 'Tracker', 'Monitor'],
      version: { major: 0, minor: 5, build: 0 }
    }

    archi.connect(connectionInfo).then(() => {
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
