import { describe, expect, it } from 'vitest'
import { buildPayloadPostgresPoolConfig } from './payloadPostgresPool'

describe('buildPayloadPostgresPoolConfig', () => {
  it('uses a small serverless-safe pool by default', () => {
    expect(buildPayloadPostgresPoolConfig('postgres://example/db', {})).toEqual({
      connectionString: 'postgres://example/db',
      max: 2,
      min: 0,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
    })
  })

  it('allows explicit pool sizing overrides', () => {
    expect(
      buildPayloadPostgresPoolConfig('postgres://example/db', {
        PAYLOAD_POSTGRES_POOL_MAX: '6',
        PAYLOAD_POSTGRES_POOL_IDLE_TIMEOUT_MS: '12000',
        PAYLOAD_POSTGRES_POOL_CONNECTION_TIMEOUT_MS: '9000',
      }),
    ).toEqual({
      connectionString: 'postgres://example/db',
      max: 6,
      min: 0,
      idleTimeoutMillis: 12_000,
      connectionTimeoutMillis: 9_000,
    })
  })

  it('keeps at least one query slot in addition to Payload initialization', () => {
    expect(
      buildPayloadPostgresPoolConfig('postgres://example/db', {
        PAYLOAD_POSTGRES_POOL_MAX: '1',
      }).max,
    ).toBe(2)
  })
})
