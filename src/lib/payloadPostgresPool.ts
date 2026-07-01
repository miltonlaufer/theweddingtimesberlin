const DEFAULT_POOL_MAX = 2
const MIN_POOL_MAX = 2
const DEFAULT_IDLE_TIMEOUT_MS = 5_000
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000

type PoolEnv = Record<string, string | undefined>
type PayloadPostgresPoolConfig = {
  connectionString: string
  max: number
  min: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

export function buildPayloadPostgresPoolConfig(
  connectionString: string,
  env: PoolEnv = process.env,
): PayloadPostgresPoolConfig {
  const configuredMax = parsePositiveInteger(env.PAYLOAD_POSTGRES_POOL_MAX, DEFAULT_POOL_MAX)
  const max = Math.max(MIN_POOL_MAX, configuredMax)
  const idleTimeoutMillis = parsePositiveInteger(
    env.PAYLOAD_POSTGRES_POOL_IDLE_TIMEOUT_MS,
    DEFAULT_IDLE_TIMEOUT_MS,
  )
  const connectionTimeoutMillis = parsePositiveInteger(
    env.PAYLOAD_POSTGRES_POOL_CONNECTION_TIMEOUT_MS,
    DEFAULT_CONNECTION_TIMEOUT_MS,
  )

  return {
    connectionString,
    max,
    min: 0,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  }
}
