import Command from '../classes/command'
import {
  ActionRowBuilder,
  ApplicationCommandOption,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags
} from 'discord.js'
import Database from '../utils/database'

const PAGE_SIZE = 3
const DEFAULT_LINKS_COLOR = 0x0099FF

function parseHexColor (raw?: string | null): number | null {
  if (!raw) return null
  const normalized = raw.replace(/^#/, '').trim()
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return null
  return parseInt(normalized, 16)
}

function boolIcon (value: boolean) {
  return value ? '✅' : '❌'
}

function normalizeLinks (links: any[]) {
  return links.map(link => ({
    ...link,
    mention_join_leave: !!link.mention_join_leave,
    mention_item_finder: !!link.mention_item_finder,
    mention_item_receiver: !!link.mention_item_receiver,
    mention_completion: !!link.mention_completion,
    mention_hints: !!link.mention_hints
  }))
}

function filterLinks (links: any[], userId?: string, playerFilter?: string) {
  const normalized = normalizeLinks(links)
  const normalizedPlayer = playerFilter?.trim().toLowerCase()

  return normalized.filter(link => {
    const matchesUser = userId ? String(link.discord_id) === String(userId) : true
    const matchesPlayer = normalizedPlayer
      ? String(link.archipelago_name).toLowerCase().includes(normalizedPlayer)
      : true

    return matchesUser && matchesPlayer
  })
}

export function buildLinksView (
  guildId: string,
  links: any[],
  page: number = 0,
  userId?: string,
  playerFilter?: string
) {
  const filtered = filterLinks(links, userId, playerFilter)

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)

  const titleParts: string[] = ['Linked Archipelago Players']
  if (userId) titleParts.push(`for <@${userId}>`)
  if (playerFilter) titleParts.push(`matching "${playerFilter}"`)
  const title = titleParts.join(' ')

  if (total === 0) {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription('No matching linked Archipelago players found.')
      .setColor(DEFAULT_LINKS_COLOR)

    return {
      embeds: [embed],
      components: []
    }
  }

  const start = safePage * PAGE_SIZE
  const pageItems = filtered.slice(start, start + PAGE_SIZE)

  const firstValidColor =
    filtered.map(link => parseHexColor(link.embed_color)).find((c: number | null) => c != null) ?? DEFAULT_LINKS_COLOR

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription('Current player-to-user mappings and notification preferences.')
    .setColor(firstValidColor)
    .setFooter({ text: `Page ${safePage + 1} of ${totalPages} • ${total} link${total === 1 ? '' : 's'}` })

  for (const link of pageItems) {
    const colorText = link.embed_color ? `#${String(link.embed_color).replace(/^#/, '').toUpperCase()}` : 'Default'

    embed.addFields({
      name: `${link.archipelago_name}`,
      value: [
        `User: <@${link.discord_id}>`,
        `Embed Color: \`${colorText}\``,
        `Join/Leave: ${boolIcon(link.mention_join_leave)}`,
        `Item Finder: ${boolIcon(link.mention_item_finder)}`,
        `Item Receiver: ${boolIcon(link.mention_item_receiver)}`,
        `Completion: ${boolIcon(link.mention_completion)}`,
        `Hints: ${boolIcon(link.mention_hints)}`
      ].join('\n'),
      inline: false
    })
  }

  const userKey = userId ?? 'all'
  const playerKey = playerFilter ? encodeURIComponent(playerFilter) : 'all'

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`links_prev:${safePage}:${userKey}:${playerKey}`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`links_next:${safePage}:${userKey}:${playerKey}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1)
  )

  return {
    embeds: [embed],
    components: [navRow]
  }
}

export default class LinksCommand extends Command {
  name = 'links'
  description = 'Show linked Archipelago players in this server.'

  options: ApplicationCommandOption[] = [
    {
      type: ApplicationCommandOptionType.User,
      name: 'user',
      description: 'Optional Discord user to show only their linked players',
      required: false
    },
    {
      type: ApplicationCommandOptionType.String,
      name: 'player',
      description: 'Optional player filter',
      required: false
    }
  ]

  constructor (client: any) {
    super()
    this.client = client
  }

  async execute (interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: [MessageFlags.Ephemeral]
      })
      return
    }

    try {
      const user = interaction.options.getUser('user')
      const player = interaction.options.getString('player')?.trim()
      const links = await Database.getLinks(interaction.guildId)
      const view = buildLinksView(interaction.guildId, links, 0, user?.id, player)

      await interaction.reply({
        ...view,
        flags: [MessageFlags.Ephemeral]
      })
    } catch (err) {
      console.error('Failed to get links:', err)
      await interaction.reply({
        content: 'Failed to retrieve links from database.',
        flags: [MessageFlags.Ephemeral]
      })
    }
  }
}