/**
 * 把前端打包成 Android APK。
 *
 * 與 build-cf.mjs 平行的一支：同一份前端，換一個載體。
 *
 * 為什麼要專門一支腳本，而不是直接 `cap sync` 了事：
 *   1. **建置戳記要注入。** 與網頁版共用同一套戳記機制，「設置」頁才看得出
 *      手上這包是哪一版。
 *   2. **產物要驗。** 少了 index.html 是裝到手機上才會發現的故障。
 *
 * APK **不包含任何音源檔**。播放器與音源分離不只是介面上的事 —— 隨附一份音源
 * 等於預設了來源，而這個 app 的立場是音源由使用者自己提供。使用者到「設置」頁
 * 貼上自己的音源網址即可。
 *
 * 用法：
 *   pnpm build:apk          → 產出 debug APK（可直接側載安裝）
 *   pnpm build:apk release   → 產出 unsigned release APK（要自己簽名才能安裝）
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildStamp } from './build-stamp.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'packages/web/dist')
const ANDROID = path.join(ROOT, 'android')
const variant = process.argv[2] === 'release' ? 'release' : 'debug'

/** Android Studio 自帶的 JDK 與 SDK。找不到就讓使用者用環境變數指定 */
function resolveAndroidEnv() {
  const javaHome = process.env.JAVA_HOME
    || '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
  const sdk = process.env.ANDROID_HOME
    || process.env.ANDROID_SDK_ROOT
    || path.join(process.env.HOME || '', 'Library/Android/sdk')
  if (!fs.existsSync(path.join(javaHome, 'bin/java'))) {
    console.error(`✘ 找不到 JDK：${javaHome}\n  用 JAVA_HOME 指定，或安裝 Android Studio。`)
    process.exit(1)
  }
  if (!fs.existsSync(sdk)) {
    console.error(`✘ 找不到 Android SDK：${sdk}\n  用 ANDROID_HOME 指定。`)
    process.exit(1)
  }
  return { javaHome, sdk }
}

const { javaHome, sdk } = resolveAndroidEnv()
const stamp = buildStamp()
const env = {
  ...process.env,
  BUILD_STAMP: stamp,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
}
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd: cwd || ROOT, env, stdio: 'inherit' })

console.log(`▸ 建置戳記：${stamp}`)

// 1) 前端（vite 讀 BUILD_STAMP 注入戳記）
run('pnpm', ['--filter', '@whymusic/web', 'build'])

// 2) 驗證即將進 APK 的資產。
//    檢查的是 packages/web/dist —— 那是 cap sync 的**來源**，也是唯一能塞東西
//    進 APK 的地方（sync 會先清空目的地再整包複製，所以檢查目的地等於什麼都沒查）。
//    「不能有音源檔」是刻意的守衛：隨附音源就等於替使用者預設了來源，
//    違反這個 app 的分離立場。放進 public/ 的東西 vite 會照抄進 dist，很容易誤入。
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('✘ dist 缺少 index.html')
  process.exit(1)
}
for (const dir of ['sources', 'plugins']) {
  if (fs.existsSync(path.join(DIST, dir))) {
    console.error(
      `✘ dist/${dir}/ 存在 —— 本專案不隨附音源，這個目錄會被打包進 APK，請移除`,
    )
    process.exit(1)
  }
}
console.log('✓ 資產正確（且未隨附任何音源）')

// 3) 同步進原生專案
run('npx', ['cap', 'sync', 'android'])

// 4) Gradle 打包
const task = variant === 'release' ? 'assembleRelease' : 'assembleDebug'
run('./gradlew', [task, '--no-daemon'], ANDROID)

const apk = path.join(ANDROID, `app/build/outputs/apk/${variant}/app-${variant}.apk`)
if (!fs.existsSync(apk)) {
  console.error(`✘ 找不到產物：${apk}`)
  process.exit(1)
}
const mb = (fs.statSync(apk).size / 1024 / 1024).toFixed(2)
console.log(`\n✓ ${path.relative(ROOT, apk)}  (${mb} MiB, ${variant})`)
if (variant === 'debug') {
  console.log('  debug 版已用 debug key 簽名，可直接安裝：adb install -r <上面那個路徑>')
} else {
  console.log('  release 版未簽名，要簽過才能安裝（apksigner）')
}
