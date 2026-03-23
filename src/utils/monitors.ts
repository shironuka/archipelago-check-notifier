import MonitorData from '../classes/monitordata'
import { Client, itemsHandlingFlags } from 'archipelago.js'
import Monitor from '../classes/monitor'
import { Client as DiscordClient } from 'discord.js'
import Database from './database'

const monitors: Monitor[] = []

function normalizeGame (game?: string) {
  return game?.trim() ?? ''
}

function getRoomKeyFromData (data: MonitorData) {
  return `${data.host.trim()}:${data.port}|${data.channel}`
}

function getTrackedKeyFromData (data: MonitorData) {
  return `${getRoomKeyFromData(data)}|${data.player.trim()}|${normalizeGame(data.game)}`
}

function make (data: MonitorData, client: DiscordClient): Promise<Monitor> {
  return new Promise<Monitor>((resolve, reject) => {
    data.host = data.host.trim()
    data.player = data.player.trim()
    data.game = data.game?.trim()

    const uri = `${data.host}:${data.port}`
    const roomKey = getRoomKeyFromData(data)

    const existing = monitors.find(
      (monitor) => `${monitor.data.host.trim()}:${monitor.data.port}|${monitor.data.channel}` === roomKey
    )

    if (existing != null) {
      existing.addTrackedPlayer(data)
      console.log(`Added ${data.player} to existing monitor ${uri}`)
      resolve(existing)
      return
    }

    const archi = new Client()

    const connectionOptions = {
      items: itemsHandlingFlags.all,
      tags: ['Tracker']
    }

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
      monitor.addTrackedPlayer(data)

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
    (monitor) => `${monitor.data.host}:${monitor.data.port}` === uri
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

function removeByTrackedKey (trackedKey: string, removeFromDb: boolean = true) {
  const monitor = monitors.find((monitor) =>
    monitor.getTrackedPlayers().some((p: any) => getTrackedKeyFromData({
      host: monitor.data.host,
      port: monitor.data.port,
      channel: monitor.data.channel,
      player: p.player,
      game: p.game,
      mention_join_leave: false,
      mention_item_finder: false,
      mention_item_receiver: false,
      mention_completion: false,
      mention_hints: false
    } as MonitorData) === trackedKey)
  )

  if (monitor == null) return

  const tracked = monitor.getTrackedPlayers().find((p: any) => getTrackedKeyFromData({
    host: monitor.data.host,
    port: monitor.data.port,
    channel: monitor.data.channel,
    player: p.player,
    game: p.game,
    mention_join_leave: false,
    mention_item_finder: false,
    mention_item_receiver: false,
    mention_completion: false,
    mention_hints: false
  } as MonitorData) === trackedKey)

  if (tracked == null) return

  monitor.removeTrackedPlayer(tracked.player)

  if (monitor.getTrackedPlayers().length === 0) {
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
  } else {
    Database.createLog(
      monitor.guild.id,
      '0',
      `Removed tracked player ${tracked.player} from ${monitor.data.host}:${monitor.data.port}`
    )
  }
}

function has (uri: string) {
  return monitors.some(
    (monitor) => `${monitor.data.host}:${monitor.data.port}` === uri
  )
}

function hasTrackedKey (trackedKey: string) {
  return monitors.some((monitor) =>
    monitor.getTrackedPlayers().some((p: any) => getTrackedKeyFromData({
      host: monitor.data.host,
      port: monitor.data.port,
      channel: monitor.data.channel,
      player: p.player,
      game: p.game,
      mention_join_leave: false,
      mention_item_finder: false,
      mention_item_receiver: false,
      mention_completion: false,
      mention_hints: false
    } as MonitorData) === trackedKey)
  )
}

function get (guild: string) {
  return monitors.filter((monitor) => monitor.guild.id === guild)
}

const Monitors = {
  make,
  remove,
  removeByTrackedKey,
  has,
  hasTrackedKey,
  get,
  getRoomKeyFromData,
  getTrackedKeyFromData
}

export default Monitors