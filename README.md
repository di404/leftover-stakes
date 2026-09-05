# 余桩 · Leftover Stakes

Top-down grid survival + space management: plant stakes to block enemies — but stakes block **you** too. Over-planting traps yourself.

## Run

Static site, no build step.

```bash
# from this directory
python3 -m http.server 8080
# or
npx --yes serve -p 8080
```

Open `http://localhost:8080` in a browser.

## Controls

| Input | Action |
|-------|--------|
| WASD / Arrow keys | Move |
| Space / Click | Plant stake in facing direction |
| R | Remove nearest stake (~1.2s open/vulnerable window) |
| Enter / Space | Start / restart from title or death screen |

## Design (one-liner)

Survive waves by fencing the map with a limited stake stock; every stake is also a wall for the player, so greedy planting squeezes you into a death corridor within a minute.

## Tech

- `index.html` + `css/style.css` + `js/main.js` (ES module)
- Canvas ~960×540, grid 18×12
- Enemies BFS around stakes; contact damages; waves ~70s or kill target
