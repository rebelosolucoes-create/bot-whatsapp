/**
 * 🤖 Bot WhatsApp — Cabide VIP
 * - No GRUPO VIP: responde automaticamente (menu, preço, horário...)
 * - Em DM (privado): responde "chamando um atendente" e avisa o atendente
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys'
import { MongoClient } from 'mongodb'
import pkg from 'mongo-baileys'
const { useMongoDBAuthState } = pkg
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
  horario: '🕐 Funcionamos ao sab a sex, das 9h às 15h.',
  endereço: '📍 Endereço: Av Piaui, 417c- Sala  1 — Estados.',
  endereco: '📍 Endereço:  Av Piaui, 417c- Sala  1 — Estados.',
  localização: '📍 Estamos em  Av Piaui, 417c- Sala  1 — Estados.',
  pagamento: '💳 Aceitamos Pix, cartão.',
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

  const mongoClient = new MongoClient(process.env.MONGO_URI)
  await mongoClient.connect()
  const collection = mongoClient.db('cabide_vip').collection('auth_state')

  const { state, saveCreds } = await useMongoDBAuthState(collection)
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

// 1. Deixe isso FORA da função iniciarBot() (no topo do arquivo, após os imports)
const mongoClient = new MongoClient(process.env.MONGO_URI)
await mongoClient.connect()
const collection = mongoClient.db('cabide_vip').collection('auth_state')

async function iniciarBot() {
  // 2. Dentro da função iniciarBot(), deixe apenas estas duas linhas:
  const { state, saveCreds } = await useMongoDBAuthState(collection)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers.appropriate('Chrome'),
  })

iniciarBot().catch((err) => {
  console.error('❌ Erro fatal:', err)
  process.exit(1)
})