/**
 * 🤖 Bot WhatsApp — Cabide VIP
 * - No GRUPO VIP: responde automaticamente (menu, preço, horário...)
 * - Em DM (privado): responde "chamando um atendente" e avisa o atendente
 */

import http from 'http'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  initAuthCreds,
  BufferJSON,
  proto,
} from '@whiskeysockets/baileys'
import { MongoClient } from 'mongodb'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { config } from '../config.js'

let ultimoQR = ''
let statusConexao = 'Iniciando bot...'

// Servidor HTTP para manter o Render ativo e exibir o QR Code no navegador
const port = process.env.PORT || 10000
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    if (ultimoQR) {
      const qrImg = `https://qrserver.com{encodeURIComponent(ultimoQR)}`
      res.end(`
        <html>
          <head><meta http-equiv="refresh" content="20"><title>QR Code - Bot Cabide VIP</title></head>
          <body style="font-family:sans-serif;text-align:center;padding:40px;">
            <h2>Escaneie o QR Code no WhatsApp</h2>
            <img src="${qrImg}" style="width:280px;height:280px;" />
            <p>A página atualiza sozinha a cada 20 segundos.</p>
          </body>
        </html>
      `)
    } else {
      res.end(`
        <html>
          <head><meta http-equiv="refresh" content="10"><title>Bot Cabide VIP</title></head>
          <body style="font-family:sans-serif;text-align:center;padding:40px;">
            <h2>Bot WhatsApp — Cabide VIP</h2>
            <p>Status: <strong>${statusConexao}</strong></p>
            <p>A página atualiza sozinha a cada 10 segundos.</p>
          </body>
        </html>
      `)
    }
  })
  .listen(port, '0.0.0.0', () => {
    console.log(`🌐 Servidor HTTP ativo na porta ${port}`)
  })

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
  endereço: '📍 Endereço: Av Piaui, 417- Sala  1 — Estados.',
  endereco: '📍 Endereço:  Av Piaui, 417- Sala  1 — Estados.',
  localização: '📍 Estamos em  Av Piaui, 417- Sala  1 — Estados.',
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

let collection = null

async function conectarMongo() {
  if (collection) return collection
  if (!process.env.MONGO_URI) {
    throw new Error('Variável MONGO_URI não configurada no Render!')
  }
  const mongoClient = new MongoClient(process.env.MONGO_URI)
  await mongoClient.connect()
  console.log('🍃 Conectado ao MongoDB Atlas com sucesso!')
  collection = mongoClient.db('cabide_vip').collection('auth_state')
  return collection
}

// Implementação nativa de salvamento de sessão no MongoDB (sem depender do pacote mongo-baileys)
async function useMongoAuthState(col) {
  const writeData = async (data, id) => {
    await col.updateOne(
      { _id: id },
      { $set: { data: JSON.stringify(data, BufferJSON.replacer) } },
      { upsert: true }
    )
  }

  const readData = async (id) => {
    const doc = await col.findOne({ _id: id })
    return doc ? JSON.parse(doc.data, BufferJSON.reviver) : null
  }

  const removeData = async (id) => {
    await col.deleteOne({ _id: id })
  }

  const creds = (await readData('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value
            })
          )
          return data
        },
        set: async (data) => {
          const tasks = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const key = `${category}-${id}`
              tasks.push(value ? writeData(value, key) : removeData(key))
            }
          }
          await Promise.all(tasks)
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds'),
  }
}

async function iniciarBot() {
  if (!config.attendantNumber) {
    console.error('❌ Configure ATTENDANT_NUMBER no arquivo .env (seu número, só dígitos, ex: 5511999999999)')
    process.exit(1)
  }

  const col = await conectarMongo()
  const { state, saveCreds } = await useMongoAuthState(col)
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
      ultimoQR = qr
      statusConexao = 'Aguardando leitura do QR Code...'
      console.log('\n📱 Escaneie o QR Code na página web ou abaixo:')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') {
      ultimoQR = ''
      statusConexao = '✅ Bot CONECTADO e operando!'
      console.log('\n✅ Bot CONECTADO!')
      console.log(`   • Grupo VIP: "${config.groupVipName}" → respostas automáticas`)
      console.log(`   • DM (privado) → "chamando atendente" + aviso para ${config.attendantNumber}\n`)
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : undefined
      const reconectar = codigo !== DisconnectReason.loggedOut
      statusConexao = `Conexão fechada (código ${codigo}). Reconectando: ${reconectar}`
      console.log(`⚠️ ${statusConexao}`)
      if (reconectar) setTimeout(iniciarBot, 3000)
      else {
        console.log('❌ Sessão encerrada (logged out). Limpe a coleção auth_state no MongoDB e reinicie.')
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
        } catch {}
      }
      const ehGrupoVip = ehGrupo && nomeGrupo.includes(config.groupVipName)

      if (ehGrupo && !ehGrupoVip) continue

      if (!dentroDoLimite()) {
        console.log('⏸️ Limite de respostas/minuto atingido. Pulando...')
        continue
      }
      ultimasRespostas.push(Date.now())

      const numeroLimpo = jid.split('@')[0]
      const remetenteNome = msg.pushName || numeroLimpo
      console.log(`💬 [${ehGrupoVip ? 'GRUPO VIP' : 'DM'}] ${remetenteNome}: ${texto.slice(0, 80)}`)

      await sock.sendPresenceUpdate('composing', jid).catch(() => {})
      const atraso = ATRASO_MIN_MS + Math.random() * (ATRASO_MAX_MS - ATRASO_MIN_MS)
      await sleep(atraso)

      if (ehGrupoVip) {
        const resposta = await respostaVip(texto)
        await sock.sendMessage(jid, { text: resposta })
        console.log('✅ Resposta automática enviada no grupo VIP')

        if (/atendente|humano/i.test(texto)) {
