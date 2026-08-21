/**
 * 把前端打包成 Android APK。
 *
 * 與 build-cf.mjs 平行的一支：同一份前端，換一個載體。
 *
 * 為什麼要專門一支腳本，而不是直接 `cap sync` 了事：
 *   1. **音源插件必須一起進去。** app 出廠不帶音源（刻意的設計），使用者要到
 *      「設置」頁安裝，而那個連結指向同源的音源檔。vite 不會複製 repo 根的
 *      plugins/，所以在這裡補（build-cf.mjs 同理）。APK 裡放在 sources/ ——
 *      plugins/ 被 Capacitor 保留給 Cordova，每次 sync 會被清空。
 *   2. **建置戳記要注入。** 與網頁版共用同一套戳記機制，「設置」頁才看得出
 *      手上這包是哪一版。
 *   3. **產物要驗。** 少了 index.html 或音源檔都是裝到手機上才會發現的故障。
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

// 2) 音源插件當靜態資產一起打包 —— 沒有它，「設置」頁的內建音源連結會 404，
//    使用者拿到一個永遠裝不了音源、什麼都放不出來的 app。
//
//    目錄刻意叫 sources/ 而不是 plugins/：Capacitor 把 assets/public/plugins 保留
//    給 Cordova 插件，每次 cap sync 都 remove 掉整個目錄（見其 cordova.js 的
//    removePluginFiles），放那裡會被清掉。前端的 OFFICIAL_PLUGIN_URL 在原生模式
//    下也指向 /sources/，兩邊對齊。
const sourcesDst = path.join(DIST, 'sources')
fs.mkdirSync(sourcesDst, { recursive: true })
for (const name of fs.readdirSync(path.join(ROOT, 'plugins'))) {
  if (name.endsWith('.js')) {
    fs.copyFileSync(path.join(ROOT, 'plugins', name), path.join(sourcesDst, name))
  }
}
console.log('✓ 已複製音源插件到 sources/')

// 3) 同步進原生專案
run('npx', ['cap', 'sync', 'android'])

// 4) 確認真的進了 APK 的資產目錄。這兩個檔案少任何一個，都是裝到手機上才發現
const assets = path.join(ANDROID, 'app/src/main/assets/public')
for (const f of ['index.html', 'sources/whymusic.js']) {
  if (!fs.existsSync(path.join(assets, f))) {
    console.error(`✘ APK 資產缺少 ${f}`)
    process.exit(1)
  }
}
console.log('✓ APK 資產齊全（含音源插件）')

// 5) Gradle 打包
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
