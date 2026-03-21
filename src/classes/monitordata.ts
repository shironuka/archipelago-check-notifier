export default class MonitorData {
  id?: number
  host: string
  port: number
  game?: string
  player: string
  channel: string
  mention_join_leave: boolean
  mention_item_finder: boolean
  mention_item_receiver: boolean
  mention_completion: boolean
  mention_hints: boolean
}
