/**
 * Mock anitabi upstream implementing ONLY the officially documented API surface.
 * Source of truth: https://github.com/anitabi/anitabi.cn-document/blob/main/api.md
 *
 *   GET https://api.anitabi.cn/bangumi/${subjectID}/lite
 *   GET https://api.anitabi.cn/bangumi/${subjectID}/points/detail[?haveImage=true]
 *
 * Everything else answers 403, exactly like the real upstream does today, so that
 * running the real sync against this server enumerates every contract mismatch.
 *
 * Usage: node scripts/anitabi-mock-upstream.mjs [port]
 */
import http from 'node:http'

const PORT = Number(process.argv[2] || 4555)
const requestLog = []

function liteFor(id) {
  return {
    id,
    cn: `作品 ${id}`,
    title: `Subject ${id}`,
    city: '宇治市',
    cover: `https://image.anitabi.cn/bangumi/${id}.jpg?plan=h160`,
    color: '#02a7bd',
    geo: [34.90646037778022, 135.81221398475236],
    zoom: 12.38,
    modified: Date.now(),
    litePoints: [
      {
        id: 'qys7fu',
        cn: '京都音乐厅',
        name: '京都コンサートホール',
        image: `https://image.anitabi.cn/points/${id}/qys7fu.jpg?plan=h160`,
        ep: 1,
        s: 1,
        geo: [35.0503, 135.7664],
      },
    ],
    pointsLength: 2,
    imagesLength: 2,
  }
}

function pointsDetailFor(id) {
  return [
    {
      id: 'qys7fu',
      name: '京都コンサートホール',
      cn: '京都音乐厅',
      image: `https://image.anitabi.cn/points/${id}/qys7fu.jpg?plan=h160`,
      ep: 1,
      s: 1,
      geo: [35.0503, 135.7664],
      origin: 'Google Maps',
      originURL: 'https://www.google.com/maps/d/viewer?mid=example',
    },
    {
      id: '5qypywi9',
      name: '第二箸別バス停前',
      cn: '第二箸别巴士站前',
      image: `https://image.anitabi.cn/points/${id}/5qypywi9.jpg?plan=h160`,
      ep: 1,
      s: 282,
      geo: [43.8578, 141.5462],
      origin: 'Google Maps',
      originURL: 'https://www.google.com/maps/d/viewer?mid=example2',
    },
  ]
}

const CF_BLOCK_BODY =
  '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head>' +
  '<body>Sorry, you have been blocked. You are unable to access anitabi.cn</body></html>'

// —— bulk 数据包路由（与 lib/anitabi/source/bulkDecode.ts 的字段表一一对应）——
const BULK_IDS = [115908, 272510]
const BULK_MODIFIED = Date.now()

function bulkIndexRow(id) {
  return [
    id, `作品 ${id}`, `Work ${id}`, `Subject ${id}`, '宇治市', '#02a7bd',
    `/images/bangumi/${id}.jpg`, 0, 'TV',
    34.906, 135.812, 12.38,
    // pointsFlat：pid, lat, lng, priority
    [`${id}p1`, 35.0503, 135.7664, 1, `${id}p2`, 35.0511, 135.7601, 2],
    0, ['tag1'], 999, 0, 0,
  ]
}

function bulkPageEntry(id) {
  const point = (pid, img) => [
    pid, `ポイント ${pid}`, `点位 ${pid}`, 0, 0, 42,
    img, 0, 1, 120, 'mock mark', 'mock-origin', 0, 'mock folder', 7,
  ]
  return [
    id,
    [`/images/ptheme/${id}.webp`, [`${id}p1`, `${id}p2`], BULK_MODIFIED, 100, 76],
    [
      point(`${id}p1`, `/images/points/${id}/${id}p1_123.jpg`),
      point(`${id}p2`, `/images/points/${id}/${id}p2_456.jpg`),
    ],
    BULK_MODIFIED,
  ]
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname

  let status = 403
  let body = CF_BLOCK_BODY
  let type = 'text/html; charset=UTF-8'
  let verdict = 'BLOCKED (not part of the official API)'

  let m
  if ((m = path.match(/^\/bangumi\/(\d+)\/lite$/))) {
    status = 200
    type = 'application/json; charset=utf-8'
    body = JSON.stringify(liteFor(Number(m[1])))
    verdict = 'OK (documented)'
  } else if ((m = path.match(/^\/bangumi\/(\d+)\/points\/detail$/))) {
    status = 200
    type = 'application/json; charset=utf-8'
    body = JSON.stringify(pointsDetailFor(Number(m[1])))
    verdict = 'OK (documented)'
  } else if (path === '/d/g.json') {
    status = 200
    type = 'application/json; charset=utf-8'
    body = JSON.stringify([BULK_IDS.map(bulkIndexRow), 250, BULK_MODIFIED])
    verdict = 'OK bulk-index'
  } else if (path === '/d/g0.json') {
    status = 200
    type = 'application/json; charset=utf-8'
    body = JSON.stringify(BULK_IDS.map(bulkPageEntry))
    verdict = 'OK bulk-page-0'
  }

  requestLog.push({ path: path + (url.search || ''), status, verdict })
  console.log(`  ${String(status).padEnd(3)} ${path}${url.search || ''}   ${verdict}`)

  res.writeHead(status, { 'content-type': type })
  res.end(body)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-upstream] official-API-only anitabi mock on http://127.0.0.1:${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('\n[mock-upstream] request summary:')
  const agg = new Map()
  for (const r of requestLog) {
    const key = `${r.status} ${r.path.replace(/\/\d+\//g, '/{id}/').replace(/\/\d+$/, '/{id}')} — ${r.verdict}`
    agg.set(key, (agg.get(key) || 0) + 1)
  }
  for (const [k, v] of agg) console.log(`  x${String(v).padStart(4)}  ${k}`)
  server.close(() => process.exit(0))
})
