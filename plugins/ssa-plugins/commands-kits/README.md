# Chat Commands & Kits

A complete **in-game command and reward system**. Players type **chat commands you invent** and get a
reply, an admin action, or both, and they claim **kits** of items, vehicles and filled containers on
join, by command, or from a **button in Discord**. A kit can have **variants**, so it gives something
different each time, by chance or in turn. Anything can be **free or cost money, gold or fame**, with
cooldowns, claim limits, exclusive groups and time windows on **both the server's clock and the
game's**, and **nothing is charged for a delivery that did not happen**.

## How it works
- **Commands:** each has an optional reply (one message per line, with live tokens), a channel, a
  cooldown, a cost, allow and deny lists, and **admin actions**: any admin command, each with its own
  delay. Commands in a **shared cooldown group** share one cooldown.
- **Variants:** a kit can hold several, and one of them is added to the kit each time it is claimed.
  **Everything in the kit itself is always given**, and the variant comes on top, so for a kit that
  gives one thing *or* another you leave the kit's own items empty and put each alternative in its
  own variant. Variants are picked **by chance** or **in turn**.
- **Chances are shares, not percentages.** Each variant's chance is its own number over the total of
  all of them, so 1 and 1 is half each and 7 and 3 is 70% and 30%. The panel shows the percentage
  each one works out to as you type. **In turn** walks each player down the list and starts again at
  the top, and it is remembered per player, so somebody else claiming in between never skips anyone's
  turn.
- **Copy anything.** A command, a kit or a variant can be copied with everything in it, including its
  items, its cost and its time windows. A copy arrives **switched off**, with a name and a chat word
  nothing else is using, and **nobody has claimed it**, so every player can take it once more.
- **Teleport and back:** the player's position is frozen when they use a command, so a delayed action
  can return them with `{x} {y} {z}`, or a second command can with `{saved_x} {saved_y} {saved_z}`.
  The position comes from the running game when the bridge's live player data carries positions, and
  from the last save when it cannot. An action that needs a position nobody has is skipped, not sent
  to the middle of the map.
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
- **Time windows, on two clocks.** Any command or kit can be limited to certain days and hours on the
  **server's own clock**, such as a weekend kit or a command that stops overnight, and separately to
  certain hours **inside the game**, such as a kit that only exists at night. Both have to allow a
  claim, and each refusal says which of the two shut the player out and when to come back.
- **An in-game window needs the game's clock, and says so when it cannot read it.** If the bridge is
  not publishing the time of day, the in-game window is **not applied at all**: the kit or command is
  handed out at any hour, exactly as if no in-game window were set, and the box on the panel says so
  every time you open it. It is never quietly treated as closed.
- **Claim from Discord:** one message with a button opens a private menu of kits. The kit is delivered
  in game with exactly the same rules as the chat command. It needs a linked account and the player
  online in game.
- **A failed charge is recorded.** If a kit was delivered but the payment did not go through, the
  delivery is marked **NOT PAID** in the log and an admin alert is raised.

## Requirements
- The **SSA Bridge** plugin, for chat, spawning and currency.
- Optional and recommended: the bridge's **Live player data** module with *Read live player data*,
  *Money, gold and account number*, *Fame points and level* and *Time of day and day length*, so
  prices are checked against the balance the game holds right now and an in-game time window can be
  applied at all. *Name, fake name, ping*, *Position, facing and speed* and *Health, stamina,
  hydration* fill the `{ping}`, `{sector}` and `{health}` tokens. The plugin's card on the
  **Plugins** page lists them and offers to switch them on. All of them only read; none of them
  changes anything in the game.
- Manager **5.16.2+**.

## Configuration
Everything is configured from the plugin's **admin tab** (💬 Commands & Kits), in five sections:

- **Commands**: each command's *Reply in* channel, *Announce to all*, *Linked players only*,
  *Cooldown (h)*, *Shared CD group*, *Remember position*, *Notify player*, *Allow only* / *Deny*,
  *Reply text*, *When this command works*, *Admin actions* and *Cost*.
- **Kits & Packs**: *Give when* (on join or by chat command), *Command*, *Reply in*, *Cooldown (h)*,
  *Max / player*, *Exclusive group*, *Linked players only*, *Notify player*, *Claim from Discord*,
  *Allow only* / *Deny*, *Items*, *Vehicles*, *Full containers*, *Variants*, *When this kit can be
  claimed*, *…and at what time of day IN GAME*, *Message to player*, *Admin actions* and *Cost*.
- **Messages**: every system line players see (cooldown, already claimed, cannot afford, and so on),
  the words that go inside them (the balance and currency names, the in-game window line), and every
  line of the Discord claim panel, in any language. A blank field uses the built-in English.
- **Activity**: the live spawn queue, the delivery log, and **Player claims**, where claims can be
  reset for one player or for everyone. Items and rewards are shown by their names.
- **Settings**: *Command prefix*, *Default reply channel*, *Welcome delay (s)*, *Spawn gap (ms)* and
  *Spawn attempts*, the **Discord claim panel**, the **Welcome message**, and advanced spawn command
  templates.

**Tokens** work in every reply, message and action. The *Insert token* palette lists them all, each
with a line saying what it shows:
player (`{player}`, `{squad}`, `{ping}`, `{health}`, `{sector}`), server (`{online}`,
`{maxplayers}`, `{date}`, `{gametime}`, `{temperature}`, `{nextrestart}`, `{restartin}`), balances
(`{money}`, `{gold}`, `{fame}`), stats (`{kills}`, `{kd}`, `{playtime}` and more), attributes,
position (`{location}`, `{x}`, `{saved_x}`) and command arguments (`{args}`, `{arg1}`, and `{prefix}`, the command prefix).

## Good to know
- **The command prefix applies to every chat command on the server**, including other plugins'.
- **Notify player** runs a delivery through the player, so the game's own "item spawned" messages
  reach them. Off (the default) delivers silently.
- **A partial delivery is charged in full.** The player is told what did not arrive and the log row is
  marked, so you can put it right.
- A kit on **On join** with no cooldown is given **once per player**. Set a cooldown to give it again.
- **A kit with nothing in it is never handed out.** The player is told it is not ready, and neither
  their claim nor their cooldown is spent on it. A kit whose items are all in its variants counts as
  having something in it.
- **If no variant can come up**, because every one is switched off or every chance is 0, the kit
  gives only what is in the kit itself. The panel says so on the kit and the manager's log says so
  when it happens, because from a player's side it looks exactly like a kit that is working.
- **A claim that could not be delivered spends nothing**, and that includes a turn: a player whose
  kit the game refused keeps their place in the rotation as well as their cooldown and their claim.
- **Resetting a player's claims resets their place in the rotation too**, so they start again at the
  first variant.
- **A full container is filled to the top.** The game takes no count for it, so the number of sets
  does not change what arrives.
- **The item picker stays open.** Pick as many as you like in one go, with the quantity in the
  picker's own footer, and press Done.
- **Live tokens are read when the line is sent.** `{ping}`, `{health}`, `{sector}`, `{gametime}`,
  `{temperature}` and the balances come from the running game when the bridge can answer. The game
  time, temperature, sector and balances fall back to the last save. A value nobody can read,
  including a balance, a stat or a position the save cannot give, shows as `?`, never as 0.
- A new install ships a **/ping** command that answers the player's ping. An existing command list
  is never changed, so it does not appear there; add it yourself with the reply `Your ping: {ping} ms`.
- The shipped **Welcome Pack** and **Daily Kit** are examples with nothing in them, so they arrive
  switched off. Add items and turn one on. The shipped **/discord** command arrives switched off for
  the same reason: put your own invite in it first.
- When only the last save can answer, a player whose saved balance is too low is refused, and the
  message tells them the figure is from the last save.
- The Discord menu shows up to 25 kits. If you rename or re-price a kit while a player has the menu
  open, their pick is refused and they are asked to open the menu again.
- Spawn counts are capped at 1000 per entry.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
