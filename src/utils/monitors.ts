import MonitorData from '../classes/monitordata'
import { Client, itemsHandlingFlags } from 'archipelago.js'
import Monitor from '../classes/monitor'
import { Client as DiscordClient } from 'discord.js'
import Database from './database'

const monitors: Monitor[] = []
const pendingRoomConnections = new Map<string, Promise<Monitor>>()

function normalizeGame (game?: string) {
  return game?.trim() ?? ''
}

function getRoomKeyFromData (data: MonitorData) {
  return `${data.host.trim()}:${data.port}|${data.channel}`
}

function getTrackedKeyFromData (data: MonitorData) {
  return `${getRoomKeyFromData(data)}|${data.player.trim()}|${normalizeGame(data.game)}`
}

function getByRoomKey (roomKey: string) {
  return monitors.find(
    (monitor) => `${monitor.data.host.trim()}:${monitor.data.port}|${monitor.data.channel}` === roomKey
  )
}

function normalizeMonitorData (data: MonitorData) {
  const normalized = new MonitorData(data)

  normalized.host = normalized.host.trim()
  normalized.player = normalized.player.trim()
  normalized.game = normalized.game?.trim()
  normalized.channel = normalized.channel.trim()
  normalized.room_url = normalized.room_url?.trim() || null

  return normalized
}

function make (data: MonitorData, client: DiscordClient): Promise<Monitor> {
  const monitorData = normalizeMonitorData(data)

  const uri = `${monitorData.host}:${monitorData.port}`
  const roomKey = getRoomKeyFromData(monitorData)

  const existing = getByRoomKey(roomKey)

  if (existing != null) {
    if (monitorData.room_url != null) {
      existing.data.room_url = monitorData.room_url
    }

    existing.addTrackedPlayer(monitorData)
    console.log(`Added ${monitorData.player} to existing monitor ${uri}`)
    return Promise.resolve(existing)
  }

  const pending = pendingRoomConnections.get(roomKey)
  if (pending != null) {
    return pending.then((monitor) => {
      if (monitorData.room_url != null) {
        monitor.data.room_url = monitorData.room_url
      }

      monitor.addTrackedPlayer(monitorData)
      console.log(`Added ${monitorData.player} to pending monitor ${uri}`)
      return monitor
    })
  }

  const connectPromise = new Promise<Monitor>((resolve, reject) => {
    const archi = new Client()

    const connectionOptions = {
      items: itemsHandlingFlags.all,
      tags: ['Tracker']
    }

    console.log('=== LOGIN DEBUG ===')
    console.log({
      uri,
      host: monitorData.host,
      port: monitorData.port,
      player: monitorData.player,
      game: monitorData.game,
      room_url: monitorData.room_url,
      connectionOptions
    })
    console.log('===================')

    const loginPromise = monitorData.game != null && monitorData.game.length > 0
      ? archi.login(uri, monitorData.player, monitorData.game, connectionOptions)
      : archi.login(uri, monitorData.player, undefined, connectionOptions)

    loginPromise.then(() => {
      console.log(`Connected successfully to ${uri} as ${monitorData.player}`)

      const monitor = new Monitor(archi, monitorData, client)
      monitor.addTrackedPlayer(monitorData)

      Database.createLog(monitor.guild.id, '0', `Connected to ${uri}`)
      monitors.push(monitor)
      resolve(monitor)
    }).catch((err) => {
      console.error('=== LOGIN FAILED ===')
      console.error({
        uri,
        player: monitorData.player,
        game: monitorData.game,
        room_url: monitorData.room_url,
        error: err
      })
      console.error('====================')
      reject(err)
    }).finally(() => {
      pendingRoomConnections.delete(roomKey)
    })
  })

  pendingRoomConnections.set(roomKey, connectPromise)
  return connectPromise
}

async function remove (uri: string, removeFromDb: boolean = true) {
  const monitor = monitors.find(
    (monitor) => `${monitor.data.host}:${monitor.data.port}` === uri
  )

  if (monitor != null) {
    monitors.splice(monitors.indexOf(monitor), 1)
    monitor.stop()

    if (removeFromDb) {
      await Database.removeConnectionsForRoom(
        monitor.data.host,
        monitor.data.port,
        String(monitor.channel.id)
      )
      await Database.deletePresenceForRoom(getRoomKeyFromData(monitor.data))
    }

    await Database.createLog(
      monitor.guild.id,
      '0',
      `Disconnected from ${monitor.data.host}:${monitor.data.port}`
    )
    return
  }

  if (removeFromDb) {
    const matches = await Database.findConnectionsByUri(uri)

    if (matches.length > 0) {
      const first = matches[0]
      await Database.removeConnectionsForRoom(
        String(first.host).trim(),
        Number(first.port),
        String(first.channel)
      )
      await Database.deletePresenceForRoom(`${String(first.host).trim()}:${Number(first.port)}|${String(first.channel)}`)
    }
  }
}

async function removeByRoomKey (roomKey: string, removeFromDb: boolean = true) {
  const monitor = getByRoomKey(roomKey)

  if (monitor != null) {
    monitors.splice(monitors.indexOf(monitor), 1)
    monitor.stop()

    if (removeFromDb) {
      await Database.removeConnectionsForRoom(
        monitor.data.host.trim(),
        monitor.data.port,
        String(monitor.channel.id)
      )
      await Database.deletePresenceForRoom(roomKey)
    }

    await Database.createLog(
      monitor.guild.id,
      '0',
      `Disconnected from ${monitor.data.host}:${monitor.data.port}`
    )
    return
  }

  if (removeFromDb) {
    const [hostPort, channel] = roomKey.split('|')
    if (hostPort && channel) {
      const [hostRaw, portRaw] = hostPort.split(':')
      const host = hostRaw?.trim()
      const port = parseInt(portRaw ?? '', 10)

      if (host && Number.isFinite(port)) {
        await Database.removeConnectionsForRoom(host, port, channel)
        await Database.deletePresenceForRoom(roomKey)
      }
    }
  }
}

function has (uri: string) {
  return monitors.some(
    (monitor) => `${monitor.data.host}:${monitor.data.port}` === uri
  )
}

function hasRoomKey (roomKey: string) {
  return monitors.some(
    (monitor) => `${monitor.data.host.trim()}:${monitor.data.port}|${monitor.data.channel}` === roomKey
  )
}

function get (guild: string) {
  return monitors.filter((monitor) => monitor.guild.id === guild)
}

const Monitors = {
  make,
  remove,
  removeByRoomKey,
  has,
  hasRoomKey,
  get,
  getByRoomKey,
  getRoomKeyFromData,
  getTrackedKeyFromData
}

export default Monitors