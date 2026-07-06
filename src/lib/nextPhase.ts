const NEXT_PHASE_PRODUCTION_BUILD = 'phase-production-build'

export function isNextProductionBuild(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NEXT_PHASE === NEXT_PHASE_PRODUCTION_BUILD
}
