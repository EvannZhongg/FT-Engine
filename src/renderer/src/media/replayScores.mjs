export function buildReplayScores(events, refereeConfigs, bindingVersionId, playbackTimeMs) {
  const configurations = new Map(
    (refereeConfigs || []).map((referee) => [Number(referee.index), referee])
  )
  const indexes = new Set([
    ...configurations.keys(),
    ...(events || []).map((event) => Number(event.referee_index))
  ])
  const scores = {}

  indexes.forEach((index) => {
    if (!Number.isFinite(index)) return
    const config = configurations.get(index) || {}
    const matching = (events || []).filter(
      (event) =>
        Number(event.referee_index) === index &&
        event.media_sync_status === 'aligned' &&
        event.media_time_ms != null &&
        event.media_binding_version_id === bindingVersionId &&
        event.media_time_ms <= playbackTimeMs
    )
    const latest = matching.reduce((selected, event) => {
      if (!selected || event.media_time_ms > selected.media_time_ms) return event
      if (
        event.media_time_ms === selected.media_time_ms &&
        event.system_time > selected.system_time
      ) {
        return event
      }
      return selected
    }, null)

    scores[index] = {
      name: config.name || latest?.referee_name || `Referee ${index}`,
      mode: config.mode || 'SINGLE',
      total: latest?.current_total ?? 0,
      plus: latest?.total_plus ?? 0,
      minus: latest?.total_minus ?? 0,
      penalty: latest?.major_penalty ?? 0
    }
  })

  return scores
}
