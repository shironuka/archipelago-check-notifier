import {
  EmbedBuilder,
  Guild,
  Client as DiscordClient,
  GuildChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js'
import {
  Client,
  CollectJSONPacket,
  HintJSONPacket,
  ItemSendJSONPacket,
  PrintJSONPacket,
  itemsHandlingFlags
} from 'archipelago.js'
import MonitorData from './monitordata'
import RandomHelper from '../utils/randohelper'
import Database from '../utils/database'

export default class Monitor {
  client: Client
  channel: any
  guild: Guild
  data: MonitorData

  isReconnecting: boolean = false
  isActive: boolean = true
  reconnectTimeout: NodeJS.Timeout | null = null

  // Suppress join/part spam briefly after startup/reconnect
  suppressPresenceMessages: boolean = true
  suppressPresenceTimeout: NodeJS.Timeout | null = null

  // Players currently seen as online from live Join/Part events
  onlinePlayers: Set<string> = new Set()

  // Players we've seen status for at least once
  knownPlayers: Set<string> = new Set()

  // Tracked players consolidated under this one room connection
  trackedPlayers: Map<string, { player: string, game?: string }> = new Map()

  queue = {
    hints: [] as string[],
    items: [] as string[]
  }

  stop () {
    this.isActive = false

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.suppressPresenceTimeout) {
      clearTimeout(this.suppressPresenceTimeout)
      this.suppressPresenceTimeout = null
    }

    this.client.socket.disconnect()
  }

  private startPresenceSuppressWindow () {
    this.suppressPresenceMessages = true

    if (this.suppressPresenceTimeout) {
      clearTimeout(this.suppressPresenceTimeout)
    }

    this.suppressPresenceTimeout = setTimeout(() => {
      this.suppressPresenceMessages = false
      this.suppressPresenceTimeout = null
    }, 8000)
  }

  addTrackedPlayer (data: MonitorData) {
    const player = data.player.trim()
    if (player.length === 0) return

    this.trackedPlayers.set(player, {
      player,
      game: data.game?.trim()
    })
  }

  removeTrackedPlayer (player: string) {
    this.trackedPlayers.delete(player.trim())
  }

  getTrackedPlayers () {
    return Array.from(this.trackedPlayers.values())
  }

  private setPlayerOnlineByName (playerName?: string | null) {
    if (playerName != null && playerName.trim().length > 0) {
      const name = playerName.trim()
      this.knownPlayers.add(name)
      this.onlinePlayers.add(name)
    }
  }

  private setPlayerOfflineByName (playerName?: string | null) {
    if (playerName != null && playerName.trim().length > 0) {
      const name = playerName.trim()
      this.knownPlayers.add(name)
      this.onlinePlayers.delete(name)
    }
  }

  private setPlayerOnlineBySlot (slot: number) {
    const playerName = this.client.players.findPlayer(slot)?.name
    this.setPlayerOnlineByName(playerName)
  }

  private setPlayerOfflineBySlot (slot: number) {
    const playerName = this.client.players.findPlayer(slot)?.name
    this.setPlayerOfflineByName(playerName)
  }

  getPlayerStatus (playerName?: string | null) {
    if (playerName == null || playerName.trim().length === 0) return 'unknown'

    const name = playerName.trim()

    if (this.onlinePlayers.has(name)) return 'online'
    if (this.knownPlayers.has(name)) return 'offline'

    return 'unknown'
  }

  isPlayerOnline (playerName?: string | null) {
    return this.getPlayerStatus(playerName) === 'online'
  }

  getAllRoomPlayers () {
    const playersManager: any = this.client.players
    const results: Array<{ name: string, game?: string }> = []

    const pushPlayer = (player: any) => {
      if (player?.name) {
        results.push({
          name: String(player.name),
          game: player.game != null ? String(player.game) : undefined
        })
      }
    }

    if (Array.isArray(playersManager?.slots)) {
      for (const player of playersManager.slots) {
        pushPlayer(player)
      }
    } else if (playersManager?.slots instanceof Map) {
      for (const [, player] of playersManager.slots) {
        pushPlayer(player)
      }
    } else if (playersManager?.slots && typeof playersManager.slots === 'object') {
      for (const key of Object.keys(playersManager.slots)) {
        pushPlayer(playersManager.slots[key])
      }
    }

    if (results.length === 0) {
      for (const tracked of this.getTrackedPlayers()) {
        results.push({
          name: tracked.player,
          game: tracked.game
        })
      }
    }

    const deduped = new Map<string, { name: string, game?: string }>()
    for (const player of results) {
      if (!deduped.has(player.name)) {
        deduped.set(player.name, player)
      }
    }

    return Array.from(deduped.values())
  }

  convertData (message: ItemSendJSONPacket | CollectJSONPacket | HintJSONPacket, linkMap: Map<string, any>) {
    return message.data.map((slot) => {
      switch (slot.type) {
        case 'player_id': {
          const playerId = parseInt(slot.text)
          const playerName = this.client.players.findPlayer(playerId)?.name
          const link = playerName ? linkMap.get(playerName) : null

          if (link) {
            let shouldMention = true

            if (message.type === 'ItemSend') {
              if (playerId === (message as any).receiving) {
                shouldMention = this.data.mention_item_receiver && link.mention_item_receiver
              } else {
                shouldMention = this.data.mention_item_finder && link.mention_item_finder
              }
            } else if (message.type === 'Hint') {
              shouldMention = this.data.mention_hints && link.mention_hints
            } else if (message.type === 'Collect') {
              shouldMention = this.data.mention_item_finder && link.mention_item_finder
            }

            if (shouldMention) {
              return `<@${link.discord_id}>`
            }
          }

          return `**${playerName ?? slot.text}**`
        }

        case 'item_id':
          return `*${RandomHelper.getItem(this.client, slot.player, parseInt(slot.text), slot.flags)}*`

        case 'location_id':
          return `**${RandomHelper.getLocation(this.client, slot.player, parseInt(slot.text))}**`

        default:
          return slot.text
      }
    }).join(' ')
  }

  addQueue (message: string, type: 'hints' | 'items' = 'hints') {
    if (this.queue.hints.length === 0 && this.queue.items.length === 0) {
      setTimeout(() => this.sendQueue(), 150)
    }

    switch (type) {
      case 'hints':
        this.queue.hints.push(message)
        break
      case 'items':
        this.queue.items.push(message)
        break
    }
  }

  sendQueue () {
    const hints = this.queue.hints.map((message, index) => ({
      name: `#${index + 1}`,
      value: message
    }))
    this.queue.hints = []

    while (hints.length > 0) {
      const batch = hints.splice(0, 25)
      const mentions = new Set<string>()
      const regex = /<@(\d+)>/g

      batch.forEach(f => {
        let match
        while ((match = regex.exec(f.value)) !== null) {
          mentions.add(match[1])
        }
      })

      const content = mentions.size > 0
        ? Array.from(mentions).map(id => `<@${id}>`).join(' ')
        : undefined

      const embed = new EmbedBuilder().setTitle('Hints').addFields(batch).data
      this.channel.send({ content, embeds: [embed] }).catch(console.error)
    }

    const items = this.queue.items.map((message, index) => ({
      name: `#${index + 1}`,
      value: message
    }))
    this.queue.items = []

    while (items.length > 0) {
      const batch = items.splice(0, 25)
      const mentions = new Set<string>()
      const regex = /<@(\d+)>/g

      batch.forEach(f => {
        let match
        while ((match = regex.exec(f.value)) !== null) {
          mentions.add(match[1])
        }
      })

      const content = mentions.size > 0
        ? Array.from(mentions).map(id => `<@${id}>`).join(' ')
        : undefined

      const embed = new EmbedBuilder().setTitle('Items').addFields(batch).data
      this.channel.send({ content, embeds: [embed] }).catch(console.error)
    }
  }

  send (message: string, components?: any[]) {
    const embed = new EmbedBuilder().setDescription(message).setTitle('Archipelago')

    const mentions = new Set<string>()
    const regex = /<@(\d+)>/g
    let match
    while ((match = regex.exec(message)) !== null) {
      mentions.add(match[1])
    }

    const content = mentions.size > 0
      ? Array.from(mentions).map(id => `<@${id}>`).join(' ')
      : undefined

    this.channel.send({ content, embeds: [embed.data], components }).catch(console.error)
  }

  constructor (client: Client, monitorData: MonitorData, discordClient: DiscordClient) {
    this.client = client
    this.data = monitorData

    const channel = discordClient.channels.cache.get(monitorData.channel)
    if (!channel || !channel.isTextBased() || !(channel instanceof GuildChannel)) {
      throw new Error(`Channel ${monitorData.channel} not found, is not text-based, or is not a guild channel.`)
    }

    this.channel = channel
    this.guild = channel.guild

    this.startPresenceSuppressWindow()

    this.client.socket.on('connectionRefused', this.onDisconnect.bind(this))
    this.client.socket.on('disconnected', this.onDisconnect.bind(this))
    this.client.socket.on('printJSON', this.onJSON.bind(this))
  }

  onDisconnect () {
    if (!this.isActive || this.isReconnecting) return
    this.isReconnecting = true

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`remonitor:${this.data.id}`)
          .setLabel('Re-monitor')
          .setStyle(ButtonStyle.Primary)
      )

    this.send('Disconnected from the server.', [row])
    this.reconnect()
  }

  reconnect () {
    if (!this.isActive) return

    const connectionOptions = {
      items: itemsHandlingFlags.all,
      tags: ['Tracker']
    }

    this.client.login(
      `${this.data.host}:${this.data.port}`,
      this.data.player,
      this.data.game,
      connectionOptions
    ).then(() => {
      this.isReconnecting = false
      this.startPresenceSuppressWindow()
    }).catch(() => {
      if (!this.isActive) return
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null
        this.reconnect()
      }, 300000)
    })
  }

  async onJSON (packet: PrintJSONPacket) {
    if (!this.isActive) return

    const links = await Database.getLinks(this.guild.id)
    const linkMap = new Map<string, any>(links.map(l => [l.archipelago_name, l]))

    const formatPlayer = (slot: number, monitorMentionFlag: boolean = true, flagName?: string) => {
      const playerName = this.client.players.findPlayer(slot)?.name
      const link = playerName ? linkMap.get(playerName) : null

      if (link) {
        let shouldMention = monitorMentionFlag
        if (flagName && link[flagName] !== undefined) {
          shouldMention = shouldMention && link[flagName]
        }

        if (shouldMention) {
          return `<@${link.discord_id}>`
        }
      }

      return `**${playerName ?? slot}**`
    }

    switch (packet.type) {
      case 'Collect':
      case 'ItemSend':
        this.addQueue(this.convertData(packet, linkMap), 'items')
        break

      case 'Hint':
        this.addQueue(this.convertData(packet, linkMap), 'hints')
        break

      case 'Join':
        this.setPlayerOnlineBySlot(packet.slot)

        if (this.suppressPresenceMessages) {
          break
        }

        if (packet.tags?.includes('Tracker')) {
          this.send(`A tracker for ${formatPlayer(packet.slot, this.data.mention_join_leave, 'mention_join_leave')} has joined the game!`)
          return
        }

        this.send(`${formatPlayer(packet.slot, this.data.mention_join_leave, 'mention_join_leave')} (${this.client.players.findPlayer(packet.slot)?.game}) joined the game!`)
        break

      case 'Part':
        this.setPlayerOfflineBySlot(packet.slot)

        if (this.suppressPresenceMessages) {
          break
        }

        this.send(`${formatPlayer(packet.slot, this.data.mention_join_leave, 'mention_join_leave')} (${this.client.players.findPlayer(packet.slot)?.game}) left the game!`)
        break

      case 'Goal':
        this.send(`${formatPlayer(packet.slot, this.data.mention_completion, 'mention_completion')} has completed their goal!`)
        break

      case 'Release':
        this.send(`${formatPlayer(packet.slot, this.data.mention_item_finder, 'mention_item_finder')} has released their remaining items!`)
        break
    }
  }
}