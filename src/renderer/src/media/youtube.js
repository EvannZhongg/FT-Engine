let apiPromise = null

export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === 'function') previousReady()
      resolve(window.YT)
    }

    let script = document.getElementById('youtube-iframe-api')
    if (!script) {
      script = document.createElement('script')
      script.id = 'youtube-iframe-api'
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      document.head.appendChild(script)
    }
    script.addEventListener('error', () => reject(new Error('Unable to load YouTube Player API')), {
      once: true
    })
  })
  return apiPromise
}

export function playerStateName(value) {
  const states = {
    0: 'ended',
    1: 'playing',
    2: 'paused',
    3: 'buffering',
    5: 'cued'
  }
  return states[value] || 'not_ready'
}
