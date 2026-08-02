#!/usr/bin/env node
/**
 * setup.mjs — Customer Portal Setup Scripts
 *
 * Dùng qua npm scripts:
 *   npm run setup:project  — Tạo Supabase project
 *   npm run setup:db       — Chạy schema + deploy edge function
 *   npm run setup:deploy   — Deploy lên Vercel + set env vars
 *   npm run setup:admin    — Tạo admin account (cần .env.local)
 *   npm run setup:check    — Kiểm tra môi trường sẵn sàng chưa
 */

import { execSync }    from 'child_process'
import { createInterface } from 'readline'
import { writeFileSync, existsSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir, platform } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IS_WIN    = platform() === 'win32'
const CMD       = process.argv[2] || 'check'

// ─── Colors ──────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', blue: '\x1b[34m', yellow: '\x1b[33m',
  red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m',
}
const ok   = msg => console.log(`  ${c.green}✓${c.reset} ${msg}`)
const info = msg => console.log(`  ${c.cyan}→${c.reset} ${msg}`)
const warn = msg => console.log(`  ${c.yellow}⚠${c.reset}  ${msg}`)
const err  = msg => console.log(`  ${c.red}✗${c.reset} ${msg}`)
const head = msg => { console.log(''); console.log(`${c.bold}${c.cyan}${msg}${c.reset}`) }
const sub  = msg => console.log(`    ${c.gray}${msg}${c.reset}`)

// ─── Helpers ─────────────────────────────────────────────────────────────────
const run     = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const capture = cmd => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim() } catch { return '' } }
const cmdOk   = cmd => capture(IS_WIN ? `where ${cmd}` : `which ${cmd}`) !== ''

const rl  = createInterface({ input: process.stdin, output: process.stdout })
const ask = (q, def = '') => new Promise(res => {
  const hint = def ? `${c.gray} (${def})${c.reset}` : ''
  rl.question(`  ${c.cyan}?${c.reset} ${q}${hint}: `, a => res(a.trim() || def))
})
const askSecret = q => new Promise(res => {
  if (!process.stdin.isTTY) { rl.question(`  ? ${q}: `, res); return }
  process.stdout.write(`  ${c.cyan}?${c.reset} ${q}: `)
  process.stdin.setRawMode(true)
  let val = ''
  const handler = ch => {
    const c2 = ch.toString()
    if (['\n','\r',''].includes(c2)) {
      process.stdin.setRawMode(false)
      process.stdin.removeListener('data', handler)
      process.stdout.write('\n')
      res(val)
    } else if (c2 === '') {
      val = val.slice(0,-1)
    } else { val += c2; process.stdout.write('•') }
  }
  process.stdin.on('data', handler)
})

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Load .env.local ─────────────────────────────────────────────────────────
function loadEnv() {
  const envFile = join(__dirname, '.env.local')
  if (!existsSync(envFile)) return {}
  return Object.fromEntries(
    readFileSync(envFile, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
  )
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────
async function sbRest(url, key, table, method, body) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method,
    headers: {
      'apikey': key, 'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  return res
}

async function sbAuthAdmin(url, key, path, method = 'POST', body) {
  const res = await fetch(`${url}/auth/v1/admin${path}`, {
    method,
    headers: {
      'apikey': key, 'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  return res.json()
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND: check — kiểm tra môi trường
// ═══════════════════════════════════════════════════════════════════════════════
async function cmdCheck() {
  console.log(`\n${c.bold}${c.cyan}🔍 Kiểm Tra Môi Trường${c.reset}\n`)

  let allOk = true

  // Node.js
  const nodeMajor = parseInt(process.version.slice(1))
  if (nodeMajor >= 18) ok(`Node.js ${process.version}`)
  else { err(`Node.js ${process.version} — cần 18+. Tải tại nodejs.org`); allOk = false }

  // Supabase CLI
  if (cmdOk('supabase')) ok(`Supabase CLI: ${capture('supabase --version')}`)
  else { err('Supabase CLI chưa cài — chạy: npm install -g supabase'); allOk = false }

  // Vercel CLI
  if (cmdOk('vercel')) ok(`Vercel CLI: ${capture('vercel --version')}`)
  else { err('Vercel CLI chưa cài — chạy: npm install -g vercel'); allOk = false }

  // Supabase login
  const sbToken = capture('supabase projects list 2>&1')
  if (sbToken && !sbToken.includes('not logged in') && !sbToken.includes('Error')) {
    ok('Supabase: đã đăng nhập')
  } else {
    warn('Supabase: chưa đăng nhập — chạy: supabase login')
  }

  // Vercel login
  const vercelUser = capture('vercel whoami 2>/dev/null')
  if (vercelUser && !vercelUser.includes('Error')) ok(`Vercel: đã đăng nhập (${vercelUser})`)
  else warn('Vercel: chưa đăng nhập — chạy: vercel login')

  // .env.local
  if (existsSync(join(__dirname, '.env.local'))) {
    const env = loadEnv()
    if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) ok('.env.local: đầy đủ')
    else warn('.env.local: thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY')
  } else {
    warn('.env.local: chưa có — xem Bước 7 trong SETUP_GUIDE.md')
  }

  console.log()
  if (allOk) {
    ok('Môi trường sẵn sàng! Chạy: npm run setup:project')
  } else {
    warn('Sửa các lỗi trên rồi chạy lại: npm run setup:check')
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND: project — tạo Supabase project
// ═══════════════════════════════════════════════════════════════════════════════
async function cmdProject() {
  console.log(`\n${c.bold}${c.cyan}📦 Tạo Supabase Project${c.reset}\n`)

  // Kiểm tra login
  const loginCheck = capture('supabase projects list 2>&1')
  if (loginCheck.includes('not logged in') || loginCheck.includes('Error') || loginCheck === '') {
    err('Chưa đăng nhập Supabase. Chạy trước: supabase login')
    rl.close(); process.exit(1)
  }

  // Lấy danh sách orgs
  let orgId = ''
  try {
    const orgsRaw = capture('supabase orgs list --output json')
    const orgs = JSON.parse(orgsRaw || '[]')
    if (orgs.length === 0) { err('Không tìm thấy tổ chức Supabase.'); rl.close(); process.exit(1) }
    if (orgs.length === 1) {
      orgId = orgs[0].id
      ok(`Tổ chức: ${orgs[0].name}`)
    } else {
      console.log()
      console.log('  Danh sách tổ chức:')
      orgs.forEach((o, i) => sub(`${i+1}. ${o.name} (${o.id})`))
      const pick = await ask('Chọn số tổ chức', '1')
      orgId = orgs[parseInt(pick)-1]?.id || orgs[0].id
    }
  } catch {
    err('Lỗi lấy danh sách org.')
    orgId = await ask('Nhập Organization ID thủ công (từ dashboard.supabase.com → Settings)')
  }

  // Thông tin project
  console.log()
  const name   = await ask('Tên project', 'customer-portal')
  const dbPass = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8) + 'Aa1!'

  const regions = ['ap-southeast-1','ap-northeast-1','us-east-1','eu-west-1']
  console.log()
  console.log('  Region (gần Việt Nam nhất):')
  sub('1. Singapore   (ap-southeast-1) ← khuyến nghị')
  sub('2. Tokyo       (ap-northeast-1)')
  sub('3. US East     (us-east-1)')
  sub('4. EU West     (eu-west-1)')
  const regionPick = await ask('Chọn số', '1')
  const region = regions[parseInt(regionPick)-1] || 'ap-southeast-1'

  // Tạo project
  console.log()
  info(`Đang tạo project "${name}" tại ${region}...`)
  sub('Có thể mất 1-2 phút, vui lòng chờ...')
  try {
    run(`supabase projects create "${name}" --org-id "${orgId}" --region "${region}" --db-password "${dbPass}"`)
  } catch {
    warn('Có thể tên project đã tồn tại. Tiếp tục...')
  }

  // Chờ và lấy project ref
  info('Chờ project khởi động...')
  await sleep(5000)

  let projectRef = ''
  try {
    const raw = capture('supabase projects list --output json')
    const list = JSON.parse(raw || '[]')
    const proj = list.find(p => p.name === name) || list[0]
    projectRef = proj?.id || ''
  } catch {}

  if (!projectRef) {
    warn('Không tự lấy được project ref.')
    projectRef = await ask('Paste Project Ref (từ dashboard.supabase.com → Project Settings → General)')
  }

  // Lưu thông tin ra file tạm để các bước sau dùng
  const stateFile = join(__dirname, '.setup-state.json')
  writeFileSync(stateFile, JSON.stringify({ name, orgId, projectRef, dbPass, region }, null, 2))

  ok(`Project ref: ${projectRef}`)
  ok(`DB password đã lưu vào .setup-state.json (không cần nhớ)`)
  console.log()
  console.log(`${c.bold}  ✅ Xong Bước 4! Tiếp theo: npm run setup:db${c.reset}`)
  rl.close()
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND: db — chạy schema + deploy edge function
// ═══════════════════════════════════════════════════════════════════════════════
async function cmdDb() {
  console.log(`\n${c.bold}${c.cyan}🗄️  Cài Đặt Database${c.reset}\n`)

  // Đọc state
  const stateFile = join(__dirname, '.setup-state.json')
  if (!existsSync(stateFile)) {
    err('Chưa chạy setup:project. Chạy trước: npm run setup:project')
    rl.close(); process.exit(1)
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  const { projectRef, dbPass } = state
  info(`Project: ${projectRef}`)

  // Init supabase local nếu chưa có
  if (!existsSync(join(__dirname, 'supabase', 'config.toml'))) {
    info('Khởi tạo cấu hình Supabase local...')
    try { run('supabase init --force', { stdio: 'pipe' }) } catch {}
  }

  // Copy schema vào migrations
  const migrDir = join(__dirname, 'supabase', 'migrations')
  if (!existsSync(migrDir)) mkdirSync(migrDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/\D/g,'').slice(0,14)
  const migFile = join(migrDir, `${stamp}_initial_schema.sql`)
  copyFileSync(join(__dirname, 'database', 'schema.sql'), migFile)
  ok('Schema migration đã chuẩn bị')

  // Link project
  info('Linking project...')
  try {
    run(`supabase link --project-ref "${projectRef}" --password "${dbPass}"`)
    ok('Linked thành công')
  } catch {
    warn('Link có lỗi — thử tiếp tục...')
  }

  // Đợi DB sẵn sàng
  info('Chờ database sẵn sàng...')
  await sleep(5000)

  // Push schema
  info('Chạy database migrations (16 tables + RLS)...')
  try {
    run('supabase db push')
    ok('Schema applied successfully')
  } catch {
    warn('db push lỗi — thử lại...')
    await sleep(3000)
    try { run('supabase db push') } catch { warn('Bỏ qua lỗi migration, kiểm tra trong Supabase dashboard') }
  }

  // Deploy edge function
  info('Deploy SePay webhook edge function...')
  try {
    run('supabase functions deploy webhook-sepay')
    ok('Edge Function deployed')
  } catch {
    warn('Edge Function thất bại — có thể deploy sau trong Bước Deliver')
  }

  console.log()
  console.log(`${c.bold}  ✅ Xong Bước 5! Tiếp theo:${c.reset}`)
  sub('  Bước 6: Lấy API keys từ dashboard.supabase.com → Project Settings → API')
  sub('  Bước 7: Tạo .env.local và điền keys')
  sub('  Bước 8: npm run seed')
  rl.close()
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND: admin — tạo tài khoản admin (dùng sau khi có .env.local)
// ═══════════════════════════════════════════════════════════════════════════════
async function cmdAdmin() {
  console.log(`\n${c.bold}${c.cyan}👤 Tạo Tài Khoản Admin${c.reset}\n`)

  const env = loadEnv()
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    err('Chưa có .env.local hoặc thiếu keys. Xem Bước 6-7 trong SETUP_GUIDE.md')
    rl.close(); process.exit(1)
  }

  // Cần service role key để tạo user
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log()
    warn('Cần Service Role Key để tạo admin.')
    sub('Vào: app.supabase.com → Project Settings → API → service_role (secret)')
    env.SUPABASE_SERVICE_ROLE_KEY = await ask('Paste service_role key')
    if (!env.SUPABASE_SERVICE_ROLE_KEY) { err('Thiếu key'); rl.close(); process.exit(1) }

    // Lưu lại vào .env.local
    const current = readFileSync(join(__dirname, '.env.local'), 'utf8')
    if (!current.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      writeFileSync(join(__dirname, '.env.local'), current + `\nSUPABASE_SERVICE_ROLE_KEY=${env.SUPABASE_SERVICE_ROLE_KEY}\n`)
      ok('Đã lưu service_role key vào .env.local')
    }
  }

  const email    = await ask('Email admin')
  const password = await askSecret('Mật khẩu admin (tối thiểu 8 ký tự)')
  if (!email || password.length < 8) {
    err('Email hoặc password không hợp lệ'); rl.close(); process.exit(1)
  }

  info(`Tạo user: ${email}`)
  const userData = await sbAuthAdmin(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, '/users', 'POST', {
    email, password, email_confirm: true
  })

  if (!userData.id) {
    err(`Tạo user thất bại: ${userData.message || JSON.stringify(userData)}`)
    rl.close(); process.exit(1)
  }

  // Tạo profile với role admin
  await sbRest(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, 'profiles', 'POST', {
    id: userData.id, email, display_name: 'Admin', role: 'admin'
  })

  ok(`Admin tạo thành công!`)
  console.log()
  console.log(`  ${c.bold}Email   :${c.reset} ${email}`)
  console.log(`  ${c.bold}Password:${c.reset} ${password}`)
  console.log()
  console.log(`${c.bold}  ✅ Xong Bước 9! Tiếp theo: npm run setup:deploy${c.reset}`)
  rl.close()
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND: deploy — deploy lên Vercel + set env vars
// ═══════════════════════════════════════════════════════════════════════════════
async function cmdDeploy() {
  console.log(`\n${c.bold}${c.cyan}🌐 Deploy Lên Vercel${c.reset}\n`)

  const env = loadEnv()
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    err('Chưa có .env.local. Xem Bước 6-7 trong SETUP_GUIDE.md')
    rl.close(); process.exit(1)
  }

  // Kiểm tra Vercel login
  const vercelUser = capture('vercel whoami 2>/dev/null')
  if (!vercelUser) {
    err('Chưa đăng nhập Vercel. Chạy: vercel login')
    rl.close(); process.exit(1)
  }
  ok(`Vercel: ${vercelUser}`)

  // Build check trước khi deploy
  info('Kiểm tra build...')
  try {
    run('npm run build', { stdio: 'pipe' })
    ok('Build thành công')
  } catch (e) {
    err('Build thất bại. Kiểm tra lỗi ở trên.')
    rl.close(); process.exit(1)
  }

  // Deploy lần đầu (link project Vercel)
  info('Deploy lên Vercel (lần 1 — link project)...')
  try { run('vercel --prod --yes') } catch { warn('Deploy có lỗi nhỏ, tiếp tục...') }

  // Set env vars
  info('Set environment variables...')
  const vars = [
    ['VITE_SUPABASE_URL',      env.VITE_SUPABASE_URL],
    ['VITE_SUPABASE_ANON_KEY', env.VITE_SUPABASE_ANON_KEY],
  ]

  for (const [key, val] of vars) {
    try {
      const cmd = IS_WIN
        ? `echo ${val}| vercel env add ${key} production --yes`
        : `printf '%s' "${val}" | vercel env add ${key} production --yes`
      run(cmd, { stdio: 'pipe' })
      ok(`  ${key}`)
    } catch {
      // Đã tồn tại — override
      try {
        const rm = `vercel env rm ${key} production --yes`
        run(rm, { stdio: 'pipe' })
        const cmd = IS_WIN
          ? `echo ${val}| vercel env add ${key} production --yes`
          : `printf '%s' "${val}" | vercel env add ${key} production --yes`
        run(cmd, { stdio: 'pipe' })
        ok(`  ${key} (cập nhật)`)
      } catch { warn(`  ${key} — set thủ công: vercel env add ${key} production`) }
    }
  }

  // Redeploy với env vars mới
  info('Redeploy với env vars...')
  let deployUrl = ''
  try {
    const out = capture('vercel --prod --yes')
    const match = out.match(/https:\/\/\S+\.vercel\.app/)
    deployUrl = match ? match[0] : ''
    if (deployUrl) ok(`Deployed: ${deployUrl}`)
    else { run('vercel --prod --yes'); ok('Deployed thành công') }
  } catch { warn('Redeploy thất bại. Chạy thủ công: vercel --prod') }

  console.log()
  console.log(`${c.bold}${c.green}╔══════════════════════════════════════════╗${c.reset}`)
  console.log(`${c.bold}${c.green}║      🎉 SETUP HOÀN TẤT!                 ║${c.reset}`)
  console.log(`${c.bold}${c.green}╚══════════════════════════════════════════╝${c.reset}`)
  console.log()
  if (deployUrl) console.log(`  ${c.bold}Portal URL :${c.reset} ${c.cyan}${deployUrl}${c.reset}`)
  console.log(`  ${c.bold}Admin URL  :${c.reset} ${c.cyan}${deployUrl || '(url-của-bạn)'}/admin${c.reset}`)
  console.log()
  console.log(`  ${c.bold}Bước tiếp theo:${c.reset}`)
  console.log(`  ${c.gray}1. Mở portal URL → đăng nhập bằng tài khoản admin${c.reset}`)
  console.log(`  ${c.gray}2. Vào /admin → Course Builder → cập nhật nội dung${c.reset}`)
  console.log(`  ${c.gray}3. Vào /admin → Deliver → copy webhook URL → paste vào SePay${c.reset}`)
  console.log()
  rl.close()
}

// ─── Deploy: Railway ─────────────────────────────────────────────────────────
async function cmdDeployRailway() {
  console.log(`\n${c.bold}${c.cyan}🚂 Deploy Lên Railway${c.reset}\n`)

  const env = loadEnv()
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    err('Chưa có .env.local với Supabase keys. Xem SETUP_GUIDE.md hoặc chạy /portal deploy')
    rl.close(); process.exit(1)
  }

  if (!cmdOk('railway')) {
    err('Railway CLI chưa cài. Chạy: npm i -g @railway/cli')
    rl.close(); process.exit(1)
  }

  // Kiểm tra login
  const rwWhoami = capture('railway whoami 2>/dev/null')
  if (!rwWhoami) {
    err('Chưa đăng nhập Railway. Chạy: railway login')
    sub('(sẽ mở browser để đăng nhập, sau đó chạy lại lệnh này)')
    rl.close(); process.exit(1)
  }
  ok(`Railway: ${rwWhoami}`)

  // Build check
  info('Kiểm tra build...')
  try {
    run('npm run build', { stdio: 'pipe' })
    ok('Build thành công')
  } catch {
    err('Build thất bại. Kiểm tra lỗi ở trên.')
    rl.close(); process.exit(1)
  }

  // Link project (interactive nếu chưa link)
  const hasProject = existsSync(join(__dirname, '.railway'))
  if (!hasProject) {
    info('Link Railway project (hoặc tạo mới)...')
    try { run('railway link') }
    catch { err('Link Railway thất bại'); rl.close(); process.exit(1) }
  }

  // Set env vars
  info('Set environment variables...')
  const vars = [
    ['VITE_SUPABASE_URL',        env.VITE_SUPABASE_URL],
    ['VITE_SUPABASE_ANON_KEY',   env.VITE_SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY',env.SUPABASE_SERVICE_ROLE_KEY],
    ['VITE_ADMIN_EMAIL',         env.VITE_ADMIN_EMAIL],
    ['RESEND_API_KEY',           env.RESEND_API_KEY],
    ['WEBHOOK_SECRET',           env.WEBHOOK_SECRET],
  ].filter(([, v]) => v)

  for (const [key, val] of vars) {
    try {
      run(`railway variables set ${key}="${val.replace(/"/g, '\\"')}"`, { stdio: 'pipe' })
      ok(`  ${key}`)
    } catch { warn(`  ${key} — set thủ công: railway variables set ${key}=...`) }
  }

  // Deploy
  info('Deploy lên Railway...')
  try {
    run('railway up --detach')
    ok('Deploy đã trigger')
  } catch { err('Deploy thất bại'); rl.close(); process.exit(1) }

  // Get URL
  const domainOut = capture('railway domain 2>/dev/null')
  const domainMatch = domainOut.match(/https?:\/\/\S+/)
  const deployUrl = domainMatch ? domainMatch[0] : ''

  console.log()
  console.log(`${c.bold}${c.green}╔══════════════════════════════════════════╗${c.reset}`)
  console.log(`${c.bold}${c.green}║      🎉 RAILWAY DEPLOY HOÀN TẤT!         ║${c.reset}`)
  console.log(`${c.bold}${c.green}╚══════════════════════════════════════════╝${c.reset}`)
  console.log()
  if (deployUrl) console.log(`  ${c.bold}Portal URL :${c.reset} ${c.cyan}${deployUrl}${c.reset}`)
  else console.log(`  ${c.gray}(chạy 'railway domain' để lấy URL)${c.reset}`)
  console.log()
  rl.close()
}

// ─── Router ───────────────────────────────────────────────────────────────────
const commands = {
  check          : cmdCheck,
  project        : cmdProject,
  db             : cmdDb,
  admin          : cmdAdmin,
  deploy         : cmdDeploy,
  'deploy-railway': cmdDeployRailway,
}

if (!commands[CMD]) {
  console.log(`\nLệnh không hợp lệ: ${CMD}`)
  console.log('Dùng: check | project | db | admin | deploy | deploy-railway\n')
  process.exit(1)
}

commands[CMD]().catch(e => {
  err(`Lỗi: ${e.message}`)
  rl.close()
  process.exit(1)
})
