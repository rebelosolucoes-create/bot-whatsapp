# 🤖 Bot WhatsApp — Cabide VIP

Chatbot de atendimento automático no WhatsApp usando **Baileys** (Node.js + QR Code).

## 🎯 O que faz
- **Grupo VIP** (nome em `GROUP_VIP_NAME`, padrão "Cabide VIP") → responde automaticamente com menu/respostas programadas
- **Conversa privada (DM)** → responde "estou chamando um atendente" e **avisa o atendente** (`ATTENDANT_NUMBER`) com nome, número e mensagem do cliente

⚠️ Método não-oficial (WhatsApp Web): **risco de banimento**. Para uso comercial, migre para a API Oficial do WhatsApp Business.

## 🖥️ Fase 1 — Rodar LOCAL (teste primeiro)
```bash
npm install
cp .env.example .env   # edite GROUP_VIP_NAME e ATTENDANT_NUMBER
npm start              # escaneia o QR Code pelo celular