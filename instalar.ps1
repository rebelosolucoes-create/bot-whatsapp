# ============================================
#  Instalador do Bot WhatsApp - Cabide VIP
#  Cria a pasta do projeto na Area de Trabalho
#  com todos os arquivos prontos.
# ============================================
$ErrorActionPreference = 'Stop'

$destino = Join-Path ([Environment]::GetFolderPath('Desktop')) 'whatsapp-bot-cabide-vip'
$src = Join-Path $destino 'src'

Write-Host "Criando projeto em: $destino" -ForegroundColor Cyan

if (Test-Path $destino) {
    Remove-Item $destino -Recurse -Force
}
New-Item -ItemType Directory -Path $src -Force | Out-Null

$arquivos = @{}

$arquivos['package.json'] = @'
{
  "name": "whatsapp-bot-cabide-vip",
  "version": "1.0.0",
  "description": "Chatbot de atendimento automatico no WhatsApp (Baileys) com grupo VIP",
  "type": "module",
  "main": "src/bot.js",
  "scripts": {
    "start": "node src/bot.js"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.18",
    "@hapi/boom": "^10.0.1",
    "dotenv": "^16.4.5",
    "pino": "^9.3.2",
    "qrcode-terminal": "^0.12.0"
  }
}
'@

$arquivos['config.js'] = @'
import dotenv from 'dotenv'
dotenv.config()

export const config = {
  // Nome (ou parte do nome) do grupo VIP — comparação ignora maiúsculas/minúsculas
  groupVipName: (process.env.GROUP_VIP_NAME || 'cabide vip').toLowerCase().trim(),

  // Número do atendente (só dígitos, formato internacional)
  attendantNumber: (process.env.ATTENDANT_NUMBER || '').replace(/\D/g, ''),

  // Cooldown entre respostas automáticas no mesmo chat (segundos)
  dmCooldownSeconds: Number(process.env.DM_COOLDOWN_SECONDS || 60),
}
'@

$arquivos['.env.example'] = @'
# Nome (ou parte do nome) do grupo VIP onde o bot responde automaticamente
GROUP_VIP_NAME=Cabide VIP

# Seu numero (atendente) que recebe os avisos de novas conversas
# Formato internacional, SOMENTE digitos, ex: Brasil 55 + 11 + 999999999
ATTENDANT_NUMBER=5511999999999

# Segundos de intervalo minimo entre respostas automaticas para o MESMO contato (anti-spam)
DM_COOLDOWN_SECONDS=60
'@

$arquivos['.gitignore'] = @'
node_modules/
.env
auth/
*.log
'@

$arquivos['README.md'] = @'
# 🤖 Bot WhatsApp — Cabide VIP

Chatbot de atendimento automático no WhatsApp usando Baileys (Node.js + QR Code).

## O que faz
- Grupo VIP (GROUP_VIP_NAME) -> responde automaticamente (menu, preço, horário...)
- Conversa privada (DM) -> responde "chamando um atendente" e avisa o ATTENDANT_NUMBER

## Rodar local
npm install
cp .env.example .env   (edite GROUP_VIP_NAME e ATTENDANT_NUMBER)
npm start              (escaneie o QR Code)

## Subir na VPS depois
scp -r . usuario@IP_DA_VPS:/home/usuario/whatsapp-bot-cabide-vip   (sem auth/ e .env)
Na VPS: npm install, cp .env.example .env, npm start (novo QR),
pm2 start src/bot.js --name cabide-bot && pm2 save && pm2 startup

ATENCAO: metodo nao-oficial (WhatsApp Web) — risco de banimento.
'@

$arquivos['src\bot.js'] = @'
/**
 * 🤖 Bot WhatsApp — Cabide VIP
 *
 * - No GRUPO VIP: responde automaticamente com menu/respostas
 * - Em DM (privado): responde "estou chamando um atendente" e avisa o atendente
 *
 * Rodar: npm install && cp .env.example .env && npm start (escanear QR)
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { config } from '../config.js'

const ATRASO_MIN_MS = 3000
const ATRASO_MAX_MS = 8000
const MAX_RESPOSTAS_POR_MINUTO = 12

const RESPOSTAS_VIP = {
  oi: 'Olá! 👋 Bem-vindo(a) ao *Cabide VIP*! Como posso ajudar?',
  olá: 'Olá! 👋 Bem-vindo(a) ao *Cabide VIP*! Como posso ajudar?',
  ola: 'Olá! 👋 Bem-vindo(a) ao *Cabide VIP*! Como posso ajudar?',
  'bom dia': 'Bom dia! ☀️ Bem-vindo(a) ao *Cabide VIP*!',
  'boa tarde': 'Boa tarde! 🌤️ Bem-vindo(a) ao *Cabide VIP*!',
  'boa noite': 'Boa noite! 🌙 Bem-vindo(a) ao *Cabide VIP*!',
  preço: '💰 Nossos valores: consulte nosso catálogo ou digite *atendente*.',
  valor: '💰 Nossos valores: consulte nosso catálogo ou digite *atendente*.',
  horário: '🕐 Funcionamos de seg a sex, das 9h às 18h.',
  horario: '🕐 Funcionamos de seg a sex, das 9h às 18h.',
  endereço: '📍 Endereço: Rua Exemplo, 123 — Centro.',
  endereco: '📍 Endereço: Rua Exemplo, 123 — Centro.',
  localização: '📍 Estamos em Rua Exemplo, 123 — Centro.',
  pagamento: '💳 Aceitamos Pix, cartão e boleto.',
  entrega: '🚚 Fazemos entregas em até 3 dias úteis.',
  atendente: '👤 Ok! Vou chamar um atendente humano pra você. Aguarde um instante.',
  humano: '👤 Ok! Vou chamar um atendente humano pra você. Aguarde um instante.',
  menu: '📋 *Menu Cabide VIP*\n\n1️⃣ *preço*\n2️⃣ *horário*\n3️⃣ *endereço*\n4️⃣ *pagamento*\n5️⃣ *entrega*\n6️⃣ *atendente*',
  ajuda: '📋 *Menu Cabide VIP*\n\n1️⃣ *preço*\n2️⃣ *horário*\n3️⃣ *endereço*\n4️⃣ *pagamento*\n5️⃣ *entrega*\n6️⃣ *atendente*',
}

const MENU_VIP = RESPOSTAS_VIP.menu
const RESPOSTA_DM = '🤖 Olá! Recebi sua mensagem e já estou chamando um atendente para te responder. Aguarde um instante, por favor! 🙏'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ultimasRespostas = []

function dentroDoLimite() {
  const agora = Date.now()
  while (ultimasRespostas.length && agora - ultimasRespostas[0] > 60000) ultimasRespostas.shift()
  return ultimasRespostas.length < MAX_RESPOSTAS_POR_MINUTO
}

const cooldowns = new Map()
function podeResponderDM(jid) {
  const agora = Date.now()
  const ultimo = cooldowns.get(jid) || 0
  if (agora - ultimo < config.dmCooldownSeconds * 1000) return false
  cooldowns.set(jid, agora)
  return true
}

function escolherRespostaVip(texto) {
  const msg = texto.toLowerCase().trim()
  for (const [chave, resposta] of Object.entries(RESPOSTAS_VIP)) {
    if (chave !== 'menu' && chave !== 'ajuda' && msg.includes(chave)) return resposta
  }
  return MENU_VIP
}

async function respostaVip(texto) {
  return escolherRespostaVip(texto)
}

function extrairTexto(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  )
}

async function iniciarBot() {
  if (!config.attendantNumber) {
    console.error('❌ Configure ATTENDANT_NUMBER no arquivo .env (seu número, só dígitos, ex: 5511999999999)')
    process.exit(1)
  }

  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers.appropriate('Chrome'),
  })

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      console.log('\n📱 Escaneie o QR Code abaixo com o WhatsApp do celular:')
      console.log('   WhatsApp → ⋮ → Aparelhos conectados → Conectar um aparelho\n')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') {
      console.log('\n✅ Bot CONECTADO!')
      console.log(`   • Grupo VIP: "${config.groupVipName}" → respostas automáticas`)
      console.log(`   • DM (privado) → "chamando atendente" + aviso para ${config.attendantNumber}\n`)
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : undefined
      const reconectar = codigo !== DisconnectReason.loggedOut
      console.log(`⚠️ Conexão fechada (código ${codigo}). Reconectar: ${reconectar}`)
      if (reconectar) iniciarBot()
      else {
        console.log('❌ Sessão encerrada (logged out). Apague a pasta "auth/" e rode npm start de novo.')
        process.exit(0)
      }
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe) continue
      const jid = msg.key.remoteJid
      if (jid === 'status@broadcast') continue

      const texto = extrairTexto(msg)
      if (!texto) continue

      const ehGrupo = jid.endsWith('@g.us')

      let nomeGrupo = ''
      if (ehGrupo) {
        try {
          const meta = await sock.groupMetadata(jid)
          nomeGrupo = (meta.subject || '').toLowerCase()
        } catch { }
      }
      const ehGrupoVip = ehGrupo && nomeGrupo.includes(config.groupVipName)

      if (ehGrupo && !ehGrupoVip) continue

      if (!dentroDoLimite()) {
        console.log('⏸️ Limite de respostas/minuto atingido. Pulando...')
        continue
      }
      ultimasRespostas.push(Date.now())

      const remetenteNome = msg.pushName || jid.split('@')[0]
      console.log(`💬 [${ehGrupoVip ? 'GRUPO VIP' : 'DM'}] ${remetenteNome}: ${texto.slice(0, 80)}`)

      await sock.sendPresenceUpdate('composing', jid).catch(() => {})
      const atraso = ATRASO_MIN_MS + Math.random() * (ATRASO_MAX_MS - ATRASO_MIN_MS)
      await sleep(atraso)

      if (ehGrupoVip) {
        const resposta = await respostaVip(texto)
        await sock.sendMessage(jid, { text: resposta })
        console.log('✅ Resposta automática enviada no grupo VIP')

        if (/atendente|humano/i.test(texto)) {
          await sock.sendMessage(`${config.attendantNumber}@s.whatsapp.net`, {
            text: `🔔 *Novo atendimento solicitado no grupo VIP*\n👤 Nome: ${remetenteNome}\n📱 Número: ${jid.split('@')[0]}\n💬 Mensagem: ${texto}`,
          })
        }
      } else {
        if (!podeResponderDM(jid)) {
          console.log('⏸️ Cooldown ativo para este contato.')
          await sock.sendPresenceUpdate('paused', jid).catch(() => {})
          continue
        }
        await sock.sendMessage(jid, { text: RESPOSTA_DM })
        console.log(`✅ Resposta automática enviada no privado de ${remetenteNome}`)

        await sock.sendMessage(`${config.attendantNumber}@s.whatsapp.net`, {
          text: `🔔 *Nova conversa privada recebida!*\n👤 Nome: ${remetenteNome}\n📱 Número: ${jid.split('@')[0]}\n💬 Mensagem: ${texto}\n\n👉 Responda direto pelo número ${jid.split('@')[0]}`,
        })
        console.log(`📨 Aviso enviado para o atendente (${config.attendantNumber})`)
      }

      await sock.sendPresenceUpdate('paused', jid).catch(() => {})
    }
  })
}

iniciarBot().catch((err) => {
  console.error('❌ Erro fatal:', err)
  process.exit(1)
})
'@

foreach ($nome in $arquivos.Keys) {
    $caminho = Join-Path $destino $nome
    $arquivos[$nome] | Set-Content -Path $caminho -Encoding UTF8 -NoNewline
    Write-Host "  ✔ criado: $nome" -ForegroundColor Green
}

# cria o .env a partir do exemplo
Copy-Item (Join-Path $destino '.env.example') (Join-Path $destino '.env') -Force
Write-Host "  ✔ criado: .env (EDITE ELE com suas informacoes!)" -ForegroundColor Yellow

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Projeto criado com sucesso!" -ForegroundColor Cyan
Write-Host "  Local: $destino" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "PROXIMOS PASSOS:" -ForegroundColor Yellow
Write-Host "  1. Edite o arquivo .env (nome do grupo + seu numero)"
Write-Host "  2. Abra o CMD nessa pasta e rode:  npm install"
Write-Host "  3. Depois rode:  npm start   e escaneie o QR Code"
Write-Host ""

# abre o .env no bloco de notas para editar
notepad (Join-Path $destino '.env')

$resposta = Read-Host "Quer rodar 'npm install' agora? (s/n)"
if ($resposta -eq 's' -or $resposta -eq 'S') {
    Set-Location $destino
    npm install
    Write-Host ""
    Write-Host "Agora rode: npm start   e escaneie o QR Code no celular!" -ForegroundColor Green
}