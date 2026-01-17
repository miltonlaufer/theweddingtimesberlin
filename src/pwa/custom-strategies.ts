import type { RouteHandlerCallbackOptions } from 'serwist'

const OFFLINE_PAGE = '/offline'
const PAGES_CACHE = 'pages'

export const PageStrategy = async (options: RouteHandlerCallbackOptions): Promise<Response> => {
  const { request } = options

  const fetchRequest = new Request(request, {
    credentials: 'include',
  })

  const cache = await caches.open(PAGES_CACHE)

  const cachedResponse = await cache.match(fetchRequest)

  if (cachedResponse) {
    fetchRequest.headers.set('If-None-Match', cachedResponse.headers.get('ETag') ?? '')
  }

  try {
    const networkResponse = await fetch(fetchRequest)

    if (networkResponse.ok && networkResponse.status !== 304) {
      await cache.put(fetchRequest, networkResponse.clone())

      return networkResponse
    }
  } catch {
    // Network error - fall through to cached response or offline page
  }

  if (cachedResponse) {
    return cachedResponse
  }

  const offlineResponse = await cache.match(OFFLINE_PAGE)
  if (offlineResponse) {
    return offlineResponse
  }

  return Response.error()
}

export const preCachePage = (page: string, swSelf: ServiceWorkerGlobalScope): void => {
  swSelf.caches
    .open(PAGES_CACHE)
    .then(async (cache: Cache) => {
      const fetchRequest = new Request(page, {
        credentials: 'include',
      })

      const cachedResponse = await cache.match(fetchRequest)

      if (cachedResponse) {
        return
      }

      const networkResponse = await fetch(fetchRequest)

      if (networkResponse.ok && networkResponse.status !== 304) {
        await cache.put(fetchRequest, networkResponse.clone())
      }
    })
    .catch(() => {
      // Error pre-caching page - silent fail
    })
}
