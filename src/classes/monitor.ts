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

type PresenceState = 'online' | 'offline' | 'unknown'
type QueuedMessage = {
  message: string,
  color?: number
}

const DEFAULT_EMBED_COLOR = 0x0099FF

export default class Monitor {
  client: Client
  channel: any
  guild: Guild
  data: MonitorData

  isReconnecting: boolean = false
  isActive: boolean = true
  reconnectTimeout: NodeJS.Timeout | null = null
  reconnectAttempts: number = 0

  suppressPresenceMessages: boolean = true
  suppressPresenceTimeout: NodeJS.Timeout | null = null

  ignoreSelfJoinDuringSuppressWindow: boolean = true

  onlinePlayers: Set<string> = new Set()
  knownPlayers: Set<string> = new Set()

  trackedPlayers: Map<string, { player: string, game?: string }> = new Map()

  dbPresence: Map<string, { status: PresenceState, game?: string }> = new Map()

  queue = {
    hints: [] as QueuedMessage[],
    items: [] as QueuedMessage[]
  }

  private getRoomKey () {
    return `${this.data.host}:${this.data.port}|${this.data.channel}`
  }

  private getRoomLabel () {
    return `${this.data.host}:${this.data.port}`
  }

  private parseEmbedColor (raw?: string | null): number | undefined {
    if (!raw) return undefined
    const normalized = raw.replace(/^#/, '').trim()
    if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return undefined
    return parseInt(normalized, 16)
  }

  private getPlayerEmbedColor (playerName: string | undefined, linkMap: Map<string, any>): number {
    if (!playerName) return DEFAULT_EMBED_COLOR
    const link = linkMap.get(playerName)
    const parsed = this.parseEmbedColor(link?.embed_color)
    return parsed ?? DEFAULT_EMBED_COLOR
  }

  private getFirstLinkedColorFromPacket (
    packet: ItemSendJSONPacket | CollectJSONPacket | HintJSONPacket,
    linkMap: Map<string, any>
  ): number {
    for (const slot of packet.data) {
      if (slot.type === 'player_id') {
        const playerId = parseInt(slot.text)
        const playerName = this.client.players.findPlayer(playerId)?.name
        const color = this.getPlayerEmbedColor(playerName, linkMap)
        if (color !== DEFAULT_EMBED_COLOR || linkMap.has(playerName)) {
          return color
        }
      }
    }
    return DEFAULT_EMBED_COLOR
  }

  private buildEmbed (
    title: string,
    description?: string,
    color: number = DEFAULT_EMBED_COLOR
  ) {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setFooter({ text: this.getRoomLabel() })

    if (description != null) {
      embed.setDescription(description)
    }

    return embed
  }

  private async loadPresenceFromDb () {
    try {
      const rows = await Database.getPresenceForRoom(this.getRoomKey())

      this.dbPresence.clear()

      for (const row of rows) {
        const name = String(row.player_name)
        const status = String(row.status) as PresenceState
        const game = row.game != null ? String(row.game) : undefined

        this.dbPresence.set(name, { status, game })

        if (status === 'online') {
          this.knownPlayers.add(name)
          this.onlinePlayers.add(name)
        } else if (status === 'offline') {
          this.knownPlayers.add(name)
          this.onlinePlayers.delete(name)
        }
      }
    } catch (err) {
      console.error(`Failed to load presence for room ${this.getRoomKey()}:`, err)
    }
  }

  private async savePresence (
    playerName: string,
    status: PresenceState,
    game?: string
  ) {
    try {
      await Database.upsertPresence(
        this.getRoomKey(),
        this.data.host,
        this.data.port,
        this.data.channel,
        playerName,
        game,
        status
      )

      this.dbPresence.set(playerName, { status, game })
    } catch (err) {
      console.error(`Failed to save presence for ${playerName} in ${this.getRoomKey()}:`, err)
    }
  }

  stop () {
    this.isActive = false
    this.isReconnecting = false

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.suppressPresenceTimeout) {
      clearTimeout(this.suppressPresenceTimeout)
      this.suppressPresenceTimeout = null
    }

    try {
      this.client.socket.disconnect()
    } catch (err) {
      console.error('Error while disconnecting monitor socket:', err)
    }
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

  private scheduleReconnect () {
    if (!this.isActive) return
    if (this.reconnectTimeout) return

    this.reconnectAttempts += 1
    const delay = this.reconnectAttempts <= 1 ? 10000 : 30000

    console.log(
      `Scheduling reconnect for ${this.data.host}:${this.data.port} in ${delay / 1000}s (attempt ${this.reconnectAttempts})`
    )

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      void this.reconnect()
    }, delay)
  }

  addTrackedPlayer (data: MonitorData) {
    const player = data.player.trim()
    if (player.length === 0) return

    this.trackedPlayers.set(player, {
      player,
      game: data.game?.trim()
    })

    void this.savePresence(player, 'unknown', data.game?.trim())
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

  private async setPlayerOnlineBySlot (slot: number) {
    const player = this.client.players.findPlayer(slot)
    const playerName = player?.name
    this.setPlayerOnlineByName(playerName)

    if (playerName != null) {
      await this.savePresence(playerName, 'online', player?.game)
    }
  }

  private async setPlayerOfflineBySlot (slot: number) {
    const player = this.client.players.findPlayer(slot)
    const playerName = player?.name
    this.setPlayerOfflineByName(playerName)

    if (playerName != null) {
      await this.savePresence(playerName, 'offline', player?.game)
    }
  }

  getPlayerStatus (playerName?: string | null) {
    if (playerName == null || playerName.trim().length === 0) return 'unknown'

    const name = playerName.trim()

    if (this.onlinePlayers.has(name)) return 'online'
    if (this.knownPlayers.has(name)) return 'offline'

    return this.dbPresence.get(name)?.status ?? 'unknown'
  }

  isPlayerOnline (playerName?: string | null) {
    return this.getPlayerStatus(playerName) === 'online'
  }

  getAllRoomPlayers () {
    const playersManager: any = this.client.players
    const deduped = new Map<string, { name: string, game?: string }>()

    const pushPlayer = (player: any) => {
      if (player?.name) {
        const name = String(player.name)
        if (!deduped.has(name)) {
          deduped.set(name, {
            name,
            game: player.game != null ? String(player.game) : undefined
          })
        }
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

    for (const tracked of this.getTrackedPlayers()) {
      if (!deduped.has(tracked.player)) {
        deduped.set(tracked.player, {
          name: tracked.player,
          game: tracked.game
        })
      }
    }

    for (const [playerName, presence] of this.dbPresence.entries()) {
      if (!deduped.has(playerName)) {
        deduped.set(playerName, {
          name: playerName,
          game: presence.game
        })
      }
    }

    for (const playerName of this.knownPlayers) {
      if (!deduped.has(playerName)) {
        deduped.set(playerName, { name: playerName })
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

  addQueue (message: string, type: 'hints' | 'items' = 'hints', color?: number) {
    if (this.queue.hints.length === 0 && this.queue.items.length === 0) {
      setTimeout(() => this.sendQueue(), 150)
    }

    const queued: QueuedMessage = { message, color }

    switch (type) {
      case 'hints':
        this.queue.hints.push(queued)
        break
      case 'items':
        this.queue.items.push(queued)
        break
    }
  }

  sendQueue () {
    const hints = this.queue.hints.map((entry, index) => ({
      name: `${this.getRoomLabel()} • Hint #${index + 1}`,
      value: entry.message,
      color: entry.color
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

      const embed = this.buildEmbed(
        `Archipelago • ${this.getRoomLabel()}`,
        undefined,
        batch[0]?.color ?? DEFAULT_EMBED_COLOR
      ).addFields(batch.map(({ name, value }) => ({ name, value }))).data

      this.channel.send({ content, embeds: [embed] }).catch(console.error)
    }

    const items = this.queue.items.map((entry, index) => ({
      name: `${this.getRoomLabel()} • Item #${index + 1}`,
      value: entry.message,
      color: entry.color
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

      const embed = this.buildEmbed(
        `Archipelago • ${this.getRoomLabel()}`,
        undefined,
        batch[0]?.color ?? DEFAULT_EMBED_COLOR
      ).addFields(batch.map(({ name, value }) => ({ name, value }))).data

      this.channel.send({ content, embeds: [embed] }).catch(console.error)
    }
  }

  send (message: string, components?: any[], color: number = DEFAULT_EMBED_COLOR) {
    const embed = this.buildEmbed(
      `Archipelago • ${this.getRoomLabel()}`,
      message,
      color
    )

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
    void this.loadPresenceFromDb()

    this.client.socket.on('connectionRefused', this.onDisconnect.bind(this))
    this.client.socket.on('disconnected', this.onDisconnect.bind(this))
    this.client.socket.on('printJSON', this.onJSON.bind(this))
  }

  onDisconnect () {
    if (!this.isActive) return
    if (this.isReconnecting) return

    this.isReconnecting = true

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`remonitor:${this.data.id}`)
          .setLabel('Re-monitor')
          .setStyle(ButtonStyle.Primary)
      )

    this.send('Disconnected from the server.', [row], 0xFFAA00)
    this.scheduleReconnect()
  }

  async reconnect () {
    if (!this.isActive) return

    this.isReconnecting = true

    const connectionOptions = {
      items: itemsHandlingFlags.all,
      tags: ['Tracker']
    }

    console.log(
      `Attempting reconnect to ${this.data.host}:${this.data.port} as ${this.data.player} (attempt ${this.reconnectAttempts + 1})`
    )

    try {
      await this.client.login(
        `${this.data.host}:${this.data.port}`,
        this.data.player,
        this.data.game,
        connectionOptions
      )

      this.isReconnecting = false
      this.reconnectAttempts = 0
      this.startPresenceSuppressWindow()
      await this.loadPresenceFromDb()

      // Trust the authenticated tracker slot after a successful reconnect.
      // This fixes stale "offline" status when the player was already online
      // before the bot reconnected and no fresh Join packet is emitted.
      this.setPlayerOnlineByName(this.data.player)
      await this.savePresence(this.data.player, 'online', this.data.game)

      console.log(`Reconnect successful for ${this.data.host}:${this.data.port}`)
    } catch (err) {
      console.error(`Reconnect failed for ${this.data.host}:${this.data.port}:`, err)
      this.scheduleReconnect()
    }
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
        this.addQueue(
          this.convertData(packet, linkMap),
          'items',
          this.getFirstLinkedColorFromPacket(packet, linkMap)
        )
        break

      case 'Hint':
        this.addQueue(
          this.convertData(packet, linkMap),
          'hints',
          this.getFirstLinkedColorFromPacket(packet, linkMap)
        )
        break

      case 'Join': {
        const joinedPlayer = this.client.players.findPlayer(packet.slot)?.name
        const joinedGame = this.client.players.findPlayer(packet.slot)?.game
        const selfPlayer = this.data.player?.trim()

        if (
          this.suppressPresenceMessages &&
          this.ignoreSelfJoinDuringSuppressWindow &&
          joinedPlayer != null &&
          selfPlayer.length > 0 &&
          joinedPlayer.trim() === selfPlayer
        ) {
          break
        }

        await this.setPlayerOnlineBySlot(packet.slot)

        if (this.suppressPresenceMessages) {
          break
        }

        const color = this.getPlayerEmbedColor(joinedPlayer, linkMap)

        if (packet.tags?.includes('Tracker')) {
          this.send(`A tracker for ${formatPlayer(packet.slot, this.data.mention_join_leave, 'mention_join_leave')} has joined the game!`, undefined, color)
          return
        }

        this.send(`${formatPlayer(packet.slot, this.data.mention_join_leave, 'mention_join_leave')} (${joinedGame}) joined the game!`, undefined, color)
        break
      }

      case 'Part': {
        const leftPlayer = this.client.players.findPlayer(packet.slot)?.name
        const leftGame = this.client.players.findPlayer(packet.slot)?.game
        await this.setPlayerOfflineBySlot(packet.slot)

        if (this.suppressPresenceMessages) {
          break
        }

        const color = this.getPlayerEmbedColor(leftPlayer, linkMap)
        this.send(`${formatPlayer(packet.slot, this.data.mention_join_leave, 'mention_join_leave')} (${leftGame}) left the game!`, undefined, color)
        break
      }

      case 'Goal': {
        const playerName = this.client.players.findPlayer(packet.slot)?.name
        const color = this.getPlayerEmbedColor(playerName, linkMap)
        this.send(`${formatPlayer(packet.slot, this.data.mention_completion, 'mention_completion')} has completed their goal!`, undefined, color)
        break
      }

      case 'Release': {
        const playerName = this.client.players.findPlayer(packet.slot)?.name
        const color = this.getPlayerEmbedColor(playerName, linkMap)
        this.send(`${formatPlayer(packet.slot, this.data.mention_item_finder, 'mention_item_finder')} has released their remaining items!`, undefined, color)
        break
      }
    }
  }
}