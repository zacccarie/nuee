# NUÉE — relevé de biosphère

A small open-world exploration game in the browser: you pilot a ground-effect skiff over a sea of clouds and survey a living biosphere (migrating colossi, sky jellyfish, drifting spores, thermal columns that give free lift). Creatures answer your signal with waves of points. Flat colour fields and ink lines, toon shading, no glow, no bloom.

Plain ES modules on Three.js r160 (vendored in `lib/`), no build step.

- `js/world.js`, `js/sky.js`, `js/cloudsea.js` — terrain, sky, cloud layer
- `js/creatures.js`, `js/thermals.js` — creatures and spore thermals
- `js/post.js` — ink/flat post-processing
- `js/audio.js`, `js/player.js`, `js/ui.js`

```bash
python serve.py   # then open the printed localhost URL
```
