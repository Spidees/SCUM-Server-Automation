# Raid Window

Stops defenders ending a raid by **logging out**. While a base is taking **real raid damage**, the
plugin keeps **pushing that base's offline protection back**, so it cannot switch on in the middle of
the raid. Only the base under attack is touched, its **protection length stays what it was**, and the
pushing stops once the base has been **quiet for a while**.

## How it works
- **Raid damage comes from the game itself**, through the SSA Bridge. Decay, upgrades and an admin
  clearing a build are left out, so a hit means a player hitting the base.
- **It does not look for players near the base.** Damage is what counts, so it keeps working after the
  defenders have logged off, which is when it matters.
- **A push sets protection to start later** by the time you choose, and it is **repeated** while the
  raid goes on. The protection length written back is the one that base already had.
- **A raid ends only after real quiet**: no damage for as long as you set. A bridge that stops
  answering never ends a raid early.
- **Every push is checked.** The bridge reads the base's protection before and after, so each push
  shows as *Pushed*, *No change*, *Sent* (not confirmed) or *Refused*.

## Requirements
- The **SSA Bridge** plugin.
- Two bridge modules. The **Bridge** box on the plugin's tab names them and turns them on after you
  confirm:
  - **Raid detection**: *Detect raids as they happen*.
  - **Raid protection control**: *Read and change raid protection* and *Set a flag's protection
    window*. A changed protection window cannot be undone, which is why you confirm it yourself.
- **Offline raid protection switched on in your server settings.** Without it there is nothing to push.
- Manager **5.16.2+**.

## Configuration
Everything is configured from the plugin's **admin tab** (⏳ Raid Window), with the server running or
stopped. The **?** beside each setting explains what it does:

- **Keep raids going when defenders log out**: the main switch.
- **Push protection back by**: how far ahead protection is set to start (default 60 minutes).
- **A raid is over after no damage for**: how long a base must be quiet (default 60 minutes).
- **Every hit restarts the countdown**: protection starts that long after the **last** hit, as if the
  owner had only just logged off (off by default).
- **Hits needed to count as a raid** (default 3). A destroyed building part always counts.
- **More options**: **Repeat the push every** (default 10 minutes), **Most pushes for one raid**
  (default 24), **Protection length**, base attack alerts, the cooldown skip, bases and flags to never
  touch, and **Check a flag**.
- **Under raid now**: every base being pushed, its last hit, when pushing stops and the last result,
  with a **Stop pushing** button.
- **Recent activity**: every push and every raid that ended.

## Good to know
- **Nothing is put back when a raid ends.** The last push already set when protection starts.
- **No change is normal while someone from the base is online.** The game keeps offline protection off
  while an owner or squadmate is connected, so the push that matters is the one after they log out.
  That is why it repeats.
- **Nothing happens while nobody is online**, because nobody can raid. It starts again as soon as
  someone connects.
- **Keep the repeat shorter than the push**, or protection can switch on between two pushes. The tab
  warns you.
- **Protection longer than 25 hours** is refused by the bridge's *Refuse Delay or Duration above*
  setting on the Raid protection control card. Raise it there if your bases need more.
- **A protection length over a week is never pushed**, because writing a shorter one would take
  protection away. Set a fixed **Protection length** to push it anyway.
- **The cooldown skip is off by default.** It is the game's paid skip and may charge whoever is online.
  It also needs *Reset a flag's change cooldown* on the Raid protection control card, which you turn
  on by hand.
- **A base with no flag is left alone**, and its row says so.

---

*Part of [SCUM Server Automation](https://scumsa.com) — the all-in-one SCUM dedicated server manager. Get the manager, browse every plugin and read the docs at [scumsa.com](https://scumsa.com).*
