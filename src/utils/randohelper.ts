import { Client, itemClassifications } from 'archipelago.js'

function getItem (client: Client, playerId: number, itemId: number, flag: number): string {
  const game = client.players.findPlayer(playerId)?.game
  if (game == null) return 'Unknown Item'

  const itemName = client.package.lookupItemName(game, itemId)
  if (itemName == null) return 'Unknown Item'

  if ((flag & itemClassifications.progression) !== 0) {
    return `**${itemName}**`
  }

  if ((flag & itemClassifications.trap) !== 0) {
    return `~~${itemName}~~`
  }

  if ((flag & itemClassifications.useful) !== 0) {
    return `*${itemName}*`
  }

  return itemName
}

function getLocation (client: Client, playerId: number, locationId: number): string {
  const game = client.players.findPlayer(playerId)?.game
  if (game == null) return 'Unknown Location'

  const locationName = client.package.lookupLocationName(game, locationId)
  if (locationName == null) return 'Unknown Location'

  return locationName
}

const RandomHelper = {
  getItem,
  getLocation
}

export default RandomHelper
