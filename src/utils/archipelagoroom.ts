import * as http from 'http'
import * as https from 'https'

export type RoomConnectInfo = {
  host: string,
  port: number
}

function normalizeRoomUrl (roomUrl: string) {
  const trimmed = roomUrl.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  const url = new URL(withProtocol)

  if (url.hostname.toLowerCase() !== 'archipelago.gg') {
    throw new Error('Room URL must be on archipelago.gg.')
  }

  if (!url.pathname.startsWith('/room/')) {
    throw new Error('Room URL must be an Archipelago room page URL.')
  }

  return url.toString()
}

function fetchText (urlString: string, redirects: number = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString)
    const client = url.protocol === 'http:' ? http : https

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Archipelago Discord Monitor Bot'
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location &&
          redirects > 0
        ) {
          const nextUrl = new URL(response.headers.location, url).toString()
          response.resume()

          fetchText(nextUrl, redirects - 1)
            .then(resolve)
            .catch(reject)

          return
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume()
          reject(new Error(`Failed to fetch room page: HTTP ${statusCode}`))
          return
        }

        let body = ''
        response.setEncoding('utf8')

        response.on('data', chunk => {
          body += chunk
        })

        response.on('end', () => {
          resolve(body)
        })
      }
    )

    request.setTimeout(15000, () => {
      request.destroy(new Error('Timed out while fetching Archipelago room page.'))
    })

    request.on('error', reject)
  })
}

export function parseCurrentRoomConnectInfo (html: string): RoomConnectInfo | null {
  const connectCommandMatch = html.match(/\/connect\s+([a-zA-Z0-9.-]+):(\d{2,5})/i)

  if (connectCommandMatch) {
    return {
      host: connectCommandMatch[1],
      port: parseInt(connectCommandMatch[2], 10)
    }
  }

  const hostPortMatch = html.match(/\b(archipelago\.gg):(\d{2,5})\b/i)

  if (hostPortMatch) {
    return {
      host: hostPortMatch[1],
      port: parseInt(hostPortMatch[2], 10)
    }
  }

  return null
}

export async function getCurrentRoomConnectInfo (
  roomUrl?: string | null
): Promise<RoomConnectInfo | null> {
  if (!roomUrl) return null

  const normalizedUrl = normalizeRoomUrl(roomUrl)
  const html = await fetchText(normalizedUrl)

  return parseCurrentRoomConnectInfo(html)
}