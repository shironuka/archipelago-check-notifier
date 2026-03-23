export default class MonitorData {
  id: number
  host: string
  port: number
  player: string
  game?: string
  channel: string

  // mention settings (optional but used elsewhere)
  mention_join_leave: boolean
  mention_item_finder: boolean
  mention_item_receiver: boolean
  mention_hints: boolean
  mention_completion: boolean

  constructor (data: Partial<MonitorData>) {
    this.id = data.id ?? 0
    this.host = data.host ?? 'archipelago.gg'
    this.port = data.port ?? 0
    this.player = data.player ?? ''
    this.game = data.game
    this.channel = data.channel ?? ''

    this.mention_join_leave = data.mention_join_leave ?? true
    this.mention_item_finder = data.mention_item_finder ?? true
    this.mention_item_receiver = data.mention_item_receiver ?? true
    this.mention_hints = data.mention_hints ?? true
    this.mention_completion = data.mention_completion ?? true
  }
}