import type { HealthStatus } from '../domain/health-status.js'

export function getHealth(): HealthStatus {
  return { status: 'ok' }
}
