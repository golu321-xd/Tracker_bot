
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} from "discord.js"

import express from "express"
import fetch from "node-fetch"
import { createClient } from "@supabase/supabase-js"

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
const app = express()
app.use(express.json())

// ===== SUPABASE =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// ===== ADMIN CHECK =====
async function isAdmin(discordId) {
  const { data } = await supabase
    .from("admins")
    .select("*")
    .eq("discord_id", discordId)
    .maybeSingle()
  return !!data
}

// ===== PING ROUTE =====
app.get("/ping", (_, res) => {
  res.send("Bot is alive")
})

// ===== ROBLOX TRACK ROUTE =====
app.post("/track", async (req, res) => {
  const { player_id, username, display_name } = req.body

  // --- BAN CHECK ---
  const { data: ban } = await supabase
    .from("bans")
    .select("*")
    .eq("player_id", player_id)
    .maybeSingle()

  if (ban?.expires_at && new Date(ban.expires_at) < new Date()) {
    await supabase.from("bans").delete().eq("player_id", player_id)
  }

  if (ban) {
    return res.json({ banned: true, reason: ban.reason })
  }

  // --- SAVE HISTORY ---
  await supabase.from("executions").insert({
    player_id,
    username,
    display_name
  })

  // --- WHITELIST CHECK ---
  const { data: wl } = await supabase
    .from("whitelist")
    .select("*")
    .eq("player_id", player_id)
    .maybeSingle()

  // --- SEND EMBED ONLY IF NOT WHITELIST ---
  if (!wl) {
    const embed = new EmbedBuilder()
      .setTitle("🚨 Script Executed")
      .setColor(0xff0000)
      .addFields(
        { name: "Username", value: username },
        { name: "Display Name", value: display_name },
        { name: "Player ID", value: player_id }
      )
      .setTimestamp()

    const channel = await client.channels.fetch(process.env.LOG_CHANNEL)
    channel.send({ embeds: [embed] })
  }

  res.json({ banned: false })
})

// ===== SERVER =====
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running"))

// ===== SELF PING (KEEP ALIVE) =====
setInterval(async () => {
  try {
    await fetch(`${process.env.SELF_URL}/ping`)
    console.log("Pinged self")
  } catch {}
}, 5 * 60 * 1000)

// ===== SLASH COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("ban")
    .addStringOption(o => o.setName("playerid").setRequired(true))
    .addStringOption(o => o.setName("reason").setRequired(true)),

  new SlashCommandBuilder()
    .setName("tempban")
    .addStringOption(o => o.setName("playerid").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setRequired(true))
    .addStringOption(o => o.setName("reason").setRequired(true)),

  new SlashCommandBuilder()
    .setName("unban")
    .addStringOption(o => o.setName("playerid").setRequired(true)),

  new SlashCommandBuilder().setName("banlist"),
  new SlashCommandBuilder().setName("clearbans"),

  new SlashCommandBuilder()
    .setName("whitelist")
    .addSubcommand(s =>
      s.setName("add")
        .addStringOption(o => o.setName("playerid").setRequired(true)))
    .addSubcommand(s =>
      s.setName("remove")
        .addStringOption(o => o.setName("playerid").setRequired(true)))
    .addSubcommand(s => s.setName("list")),

  new SlashCommandBuilder()
    .setName("history")
    .addStringOption(o => o.setName("value").setRequired(true))
].map(c => c.toJSON())

client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN)
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands })
  console.log("Bot ready")
})

// ===== COMMAND HANDLER =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return
  if (!(await isAdmin(i.user.id)))
    return i.reply({
      embeds: [new EmbedBuilder().setTitle("❌ Admin only").setColor(0xff0000)],
      ephemeral: true
    })

  const pid = i.options.getString("playerid")

  if (i.commandName === "ban") {
    await supabase.from("bans").upsert({
      player_id: pid,
      reason: i.options.getString("reason")
    })
    return i.reply({ embeds: [new EmbedBuilder().setTitle("🚫 Banned").setDescription(pid)] })
  }

  if (i.commandName === "tempban") {
    const mins = i.options.getInteger("minutes")
    const exp = new Date(Date.now() + mins * 60000)
    await supabase.from("bans").upsert({
      player_id: pid,
      reason: i.options.getString("reason"),
      expires_at: exp
    })
    return i.reply({ embeds: [new EmbedBuilder().setTitle("⏱ Tempbanned").setDescription(exp.toString())] })
  }

  if (i.commandName === "unban") {
    await supabase.from("bans").delete().eq("player_id", pid)
    return i.reply({ embeds: [new EmbedBuilder().setTitle("✅ Unbanned")] })
  }

  if (i.commandName === "banlist") {
    const { data } = await supabase.from("bans").select("*")
    return i.reply({
      embeds: [new EmbedBuilder().setTitle("🚫 Ban List").setDescription(
        data.map(b => `${b.player_id} | ${b.reason}`).join("\n") || "Empty"
      )]
    })
  }

  if (i.commandName === "clearbans") {
    await supabase.from("bans").delete().neq("player_id", "")
    return i.reply({ embeds: [new EmbedBuilder().setTitle("🧹 All bans cleared")] })
  }

  if (i.commandName === "whitelist") {
    const sub = i.options.getSubcommand()
    if (sub === "add") await supabase.from("whitelist").upsert({ player_id: pid })
    if (sub === "remove") await supabase.from("whitelist").delete().eq("player_id", pid)
    if (sub === "list") {
      const { data } = await supabase.from("whitelist").select("player_id")
      return i.reply({
        embeds: [new EmbedBuilder().setTitle("Whitelist").setDescription(
          data.map(x => x.player_id).join("\n") || "Empty"
        )]
      })
    }
    return i.reply({ embeds: [new EmbedBuilder().setTitle("Whitelist updated")] })
  }

  if (i.commandName === "history") {
    const val = i.options.getString("value")
    const { data } = await supabase
      .from("executions")
      .select("*")
      .or(`player_id.eq.${val},username.eq.${val}`)
      .order("executed_at", { ascending: false })
      .limit(10)

    return i.reply({
      embeds: [new EmbedBuilder()
        .setTitle("📜 Execution History")
        .setDescription(
          data.map(e =>
            `${e.username} (${e.player_id})\n${new Date(e.executed_at).toLocaleString()}`
          ).join("\n\n") || "No data"
        )]
    })
  }
})

client.login(process.env.DISCORD_TOKEN)
