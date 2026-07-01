module.exports = {
  platform: 'demo',
  name: 'Demo 插件',
  version: '1.0.0',

  search(query, page, type) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const results = [
          {
            id: 'demo1',
            platform: 'demo',
            title: `${query} - 歌曲1`,
            artist: 'Demo 歌手',
            artwork: 'https://via.placeholder.com/300',
          },
          {
            id: 'demo2',
            platform: 'demo',
            title: `${query} - 歌曲2`,
            artist: 'Demo 歌手',
            artwork: 'https://via.placeholder.com/300',
          },
        ]
        resolve(results)
      }, 500)
    })
  },

  getMediaSource(item, quality) {
    return new Promise((resolve) => {
      resolve({
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        quality: quality || 'standard',
      })
    })
  },
}
