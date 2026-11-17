# Blast Arena

A couch bomb-battle game for 2–4 players (humans and/or CPU) in the browser. No build step and no dependencies.

## Run it

Gamepads work most reliably when the page is served from `localhost`:

```bash
cd /Users/tvb/Desktop/projects/BMan
/usr/bin/python3 -m http.server 8765
```

Then open http://localhost:8765 in Chrome. Press any button on the controller so the browser detects it.

Opening `index.html` directly also works in Chrome.

## Controls

| Device          | Move           | Bomb            | Action (punch / Llama)     |
|-----------------|----------------|-----------------|----------------------------|
| Keyboard WASD   | W A S D        | Space           | Left Shift / E             |
| Keyboard Arrows | Arrow keys     | Enter           | Right Shift / .            |
| Gamepad         | D-pad / stick  | A / Y           | B / X / bumpers            |

Both keyboard layouts can be rebound under **Keyboard Controls**, from the title screen, Battle Setup ("Keys…") or the pause menu. Bindings are saved in the browser. The table shows the defaults.

Pause: Esc, P or Start. Kick a bomb by walking into it. Line Bomb: press Bomb again while standing on your own bomb.

## Characters, Llamas and revenge

- **Characters:** Robo, Kit, Bjorn, Kage, Spike and Zorp. Each player picks one in Battle Setup. Colour comes from the player slot. Stand still for a few seconds and each one starts their own idle routine.
- **Llama:** grab one of four colour-coded llamas to ride. Each takes one hit for you and adds a move on the Action button:
  - Punch: punch bombs over walls
  - Jump: leap 2 tiles over anything
  - Dash: sprint forward
  - Kick: walking into a bomb kicks it
- **CPU personalities:** each CPU gets a random personality per match, shown as its name in the HUD. Bomber drops as many bombs as it can, Kicker kicks bombs at you (also place-and-kick), Boxer punches bombs over walls, Hunter chases players, Greedy grabs every power-up, and Coward keeps its distance. Easy CPUs notice your bombs late, dawdle and sometimes panic-run the wrong way.
- **Final duel zoom** (setup, off by default): gently zooms in on the last two players near the end of a round.
- **Sideline revenge** (can be switched off in setup): dead players float along the wall on a cloud. Move along the wall and press Bomb to throw a bomb 3 tiles into the arena.

## Files

- `js/config.js`: rules, tuning values, items, colours
- `js/map.js`: arena themes and layout generation
- `js/game.js`: game simulation (no rendering)
- `js/ai.js`: CPU players
- `js/input.js`: keyboard and gamepad input
- `js/audio.js`: synthesized sound effects and music
- `js/render.js`: all graphics, drawn in code
- `js/main.js`: menus, match flow, main loop
