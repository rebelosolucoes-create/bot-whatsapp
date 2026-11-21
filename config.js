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