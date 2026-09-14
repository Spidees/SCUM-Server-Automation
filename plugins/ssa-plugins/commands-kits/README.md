# Chat Commands & Kits

A complete **in-game command and reward system**. Players type **chat commands you invent** and get a
reply, an admin action, or both, and they claim **kits** of items, vehicles and filled containers on
join, by command, or from a **button in Discord**. Anything can be **free or cost money, gold or
fame**, with cooldowns, claim limits and exclusive groups, and **nothing is charged for a delivery
that did not happen**.

## How it works
- **Commands:** each has an optional reply (one message per line, with live tokens), a channel, a
  cooldown, a cost, allow and deny lists, and **admin actions**: any admin command, each with its own
  delay. Commands in a **shared cooldown group** share one cooldown.
- **Teleport and back:** the player's position is frozen when they use a command, so a delayed action
  can return them with `{x} {y} {z}`, or a second command can with `{saved_x} {saved_y} {saved_z}`.
- **Kits spawn onto the player** by Steam ID. Items, vehicles and **full containers** (a backpack,
  vest or crate filled with an item) are picked from the game's own item list.
- **Spawn first, charge after.** The price is taken only once something has actually landed. If
  nothing can be delivered, the player is told and **nothing is taken**. A kit made only of admin
  actions is charged only if at least one of them ran.
- **Prices are checked against the running game** when the bridge can answer, and against the last
  save when it cannot. The cost is taken from the player's **bank account**, gold or fame.
- **One spawn queue** delivers everything one item at a time, and each spawn is retried before it
  counts as failed.
- **Linked players only:** any command or kit can be limited to players who have linked their SCUM
  character to Discord. Players who are not linked are told how to link.
- **Time windows:** any command or kit can be limited to certain days and hours, such as a weekend kit
  or a command that stops overnight. Windows run on the **server's clock**, not in-game time, and the
  refusal tells the player when to come back.
- **Claim from Discord:** one message with a button opens a private menu of kits. The kit is delivered
  in game with exactly the same rules as the chat command. It needs a linked account and the player
  online in game.
- **A failed charge is recorded.** If a kit was delivered but the payment did not go through, the
  delivery is marked **NOT PAID** in the log and an admin alert is raised.

## Requirements
- The **SSA Bridge** plugin, for chat, spawning and currency.
- Optional and recommended: the bridge's **Live player data** module with *Read live player data*,
  *Money, gold and account number* and *Fame points and level*, so prices are checked against the
  balance the game holds right now. The plugin's card on the **Plugins** page lists them and offers to
  switch them on.
- Manager **5.16.2+**.

## Configuration
Everything is configured from the plugin's **admin tab** (💬 Commands & Kits), in five sections:

- **Commands**: each command's *Reply in* channel, *Announce to all*, *Linked players only*,
  *Cooldown (h)*, *Shared CD group*, *Remember position*, *Notify player*, *Allow only* / *Deny*,
  *Reply text*, *When this command works*, *Admin actions* and *Cost*.
- **Kits & Packs**: *Give when* (on join or by chat command), *Command*, *Reply in*, *Cooldown (h)*,
  *Max / player*, *Exclusive group*, *Linked players only*, *Notify player*, *Claim from Discord*,
  *Allow only* / *Deny*, *Items*, *Vehicles*, *Full containers*, *When this kit can be claimed*,
  *Message to player*, *Admin actions* and *Cost*.
- **Messages**: every system line players see (cooldown, already claimed, cannot afford, and so on),
  in any language. A blank field uses the built-in English.
- **Activity**: the live spawn queue, the delivery log, and **Player claims**, where claims can be
  reset for one player or for everyone.
- **Settings**: *Command prefix*, *Default reply channel*, *Welcome delay (s)*, *Spawn gap (ms)* and
  *Spawn attempts*, the **Discord claim panel**, the **Welcome message**, and advanced spawn command
  templates.

**Tokens** work in every reply, message and action. The *Insert token* palette lists them all:
player (`{player}`, `{squad}`), server (`{online}`, `{maxplayers}`, `{date}`), balances (`{money}`,
`{gold}`, `{fame}`), stats (`{kills}`, `{kd}`, `{playtime}` and more), attributes, position
(`{location}`, `{x}`, `{saved_x}`) and command arguments (`{args}`, `{arg1}`).

## Good to know
- **The command prefix applies to every chat command on the server**, including other plugins'.
- **Notify player** runs a delivery through the player, so the game's own "item spawned" messages
  reach them. Off (the default) delivers silently.
- **A partial delivery is charged in full.** The player is told what did not arrive and the log row is
  marked, so you can put it right.
- A kit on **On join** with no cooldown is given **once per player**. Set a cooldown to give it again.
- The shipped **Welcome Pack** and **Daily Kit** contain no items until you add some.
- When only the last save can answer, a player whose saved balance is too low is refused, and the
  message tells them the figure is from the last save.
- The Discord menu shows up to 25 kits. If you rename or re-price a kit while a player has the menu
  open, their pick is refused and they are asked to open the menu again.
- Spawn counts are capped at 1000 per entry.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
